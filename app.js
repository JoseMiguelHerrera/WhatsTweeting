//'use strict';
var express = require('express');
var bodyParser = require('body-parser');
var watson = require('watson-developer-cloud');
var extend = require('util')._extend;
var i18n = require('i18next');
var Twitter = require('twitter');
var TwitterAuth = require("node-twitter-api-custom");
var Canvas = require("canvas");
var cloud = require("./cloud");
var d3Scale = require("d3-scale");
var jwt = require('jsonwebtoken');
var Cloudant = require('cloudant');
var fs = require("fs");
var uuidV4 = require('uuid/v4');
var path = require('path');
var cors = require('cors')
var app = express();
//var baseURL = "http://0.0.0.0:3000"; //running locally
var baseURL = "https://whatstweeting.mybluemix.net"; //running on the cloud


//set up body parser
app.use(bodyParser.urlencoded({ extended: true })); // support encoded bodies
app.use(bodyParser.json()); // support json encoded bodies
app.use("/queryResults", express.static(__dirname + '/queryResults'));


//enable cors (for testing)
app.use(cors()) //enable CORS

//i18n settings
require('./config/i18n')(app);

// Bootstrap application settings
require('./config/express')(app);

//global twitter (secret) variables (to be added to env vars later)
var consumer_key = 'nzHVwjmv85ctMPpF9rfS2OKxI';
var consumer_secret = 't7jEvPmxTHdFJ2OXW8Q4Qjq2cBMZVWYeTJIp5AzYP8dcRnqXJj';

//for authorization
var twitterauth = new TwitterAuth({
  consumerKey: consumer_key,
  consumerSecret: consumer_secret,
  callback: baseURL + "/access-token"
});

// Create the service wrapper
var personalityInsights = watson.personality_insights({
  version: 'v2',
  username: '5d14045a-3048-4a1f-ade8-c3e04d584a39',
  password: 'P0aXaZBQRx4T'
});

//database variables
var whatsTweetingDB;
var cloudantUsername = "c40ec94c-13ce-47d0-9aaf-9cbb2c530b6b-bluemix";
var cloudantPassword = "9b1041120a5a2951f5ab0a4b7c6da7b3f6a39eb03ebebf5bc5321eea14078370";
var cloudant = Cloudant({ account: cloudantUsername, password: cloudantPassword });
//database functions
var createDataBase = function (callback) {
  cloudant.db.create('whatstweeting', function (err, data) {
    if (err) {
      if (err.error === "file_exists") {
        whatsTweetingDB = cloudant.db.use('whatstweeting');
        callback(null, null); //db already exists
      } else {
        callback(err, null); //creation error
      }
    }
    else { //created successfully
      whatsTweetingDB = cloudant.db.use('whatstweeting');
      callback(null, data);
    }
  });
}

// create a document
var createDocument = function (id, val, callback) {
  // we are specifying the id of the document so we can update and delete it later
  whatsTweetingDB.insert({ _id: id, whatsTweetingData: val }, function (err, data) {
    callback(err, data);
  });
};

// read a document
var readDocument = function (id, callback) {
  whatsTweetingDB.get(id, function (err, data) {
    callback(err, data);
  });
};

// update a document
var updateDocument = function (id, document, callback) {
  // we are specifying the id of the document so we can update and delete it later
  whatsTweetingDB.insert({ _id: id, _rev: document._rev, whatsTweetingData: document.whatsTweetingData }, function (err, data) {
    callback(err, data);
  });
};

var queryDocument = function (twitterHandle, callback) {
  var selector = {
    whatsTweetingData: {
      queries: {
        $elemMatch: {
          twitterHandle: twitterHandle
        }
      }
    }
  };
  whatsTweetingDB.find({ selector: selector }, function (err, result) {
    if (err) {
      callback(err, null);
    }
    console.log('Found %d documents with twitterHandle ' + twitterHandle, result.docs.length);
    for (var i = 0; i < result.docs.length; i++) {
      console.log('  Doc id: %s', result.docs[i]._id);
    }
    callback(null, result);
  });
}


var jwtSecret = new Buffer('mySuperSecret-JWT_secret_Token').toString('base64');


//creat DB or link to existing DB as soon as server starts
createDataBase(function (err, resp) {
  if (err) { //creation error
    console.log("fatal error creating database, please start up the server again. error: " + err);
    process.exit();
  } else {
    if (!resp)
      console.log("whatstweeting db already existed, ready to use")
    else
      console.log("whatstweeting db created, ready to use")
  }
});

app.get('/', function (req, res) {
  res.render('index', { ct: req._csrfToken });
});


//twitter helper functions
function getTweetsPerPage(page, userName, totalTweets, client) {

  return new Promise(function (resolve, reject) {
    client.get('statuses/user_timeline', { screen_name: userName, count: 200, page: page }, function (error, tweet, response) {
      if (error) {
        reject(error);
      }
      else {
        var tweetsOnly = tweet.map(function (t) {
          //no retweets
          if (typeof t.retweeted_status === 'undefined') {
            return { text: t.text, timestamp: new Date(t.created_at), page: page };
          } else {
            return null;
          }
        });

        var filtered = tweetsOnly.filter(function (value) {
          return value !== null;
        });


        Array.prototype.push.apply(totalTweets.tweets, filtered);
        totalTweets.pagesAdded++;

        //console.log("have added" + totalTweets.pagesAdded + " pages");
        resolve(totalTweets);

      }
    });
  });
}

function getTweets(userName, pagenum, client, callback) {
  var totalTweets = { tweets: [], pagesAdded: 0 };

  //note max page =17 (3200 tweets)
  for (var i = 0; i < pagenum; i++) {
    getTweetsPerPage(i, userName, totalTweets, client).then(function (newTotalTweets) {
      if (newTotalTweets.pagesAdded === pagenum) {
        newTotalTweets.tweets = newTotalTweets.tweets.sort(function (a, b) {
          if (a.timestamp < b.timestamp) {
            return -1;
          } else
            return 1;
        });

        console.log("Got " + newTotalTweets.tweets.length + " tweets.")

        packtext(newTotalTweets.tweets, function (text) {
          callback(null, text);
        });

      }

    }).catch(function (error) {
      callback(error, null)
    });
  }
}

function packtext(tweets, callback) {
  var packedString = "";

  tweets.forEach(function (element) {
    if (element.page != 0) {
      var cleanedTweet;

      var cleanedTweet = element.text.replace(/(?:https?|ftp):\/\/[\n\S]+/g, ''); // no URLs
      var cleanedTweet = cleanedTweet.replace(/\r?\n|\r/g, " "); //no new line delimiter
      var hashtagReg = new RegExp('#([^\\s]*)', 'g');
      var cleanedTweet = cleanedTweet.replace(hashtagReg, ""); //no hashtags
      var MentionReg = new RegExp('@([^\\s]*)', 'g');
      var cleanedTweet = cleanedTweet.replace(MentionReg, ""); //no @ mentions

      packedString += " " + cleanedTweet;
    }
  });

  callback(packedString);
}

var _requestSecret;
app.get("/request-token", function (req, res) {

  twitterauth.getRequestToken(function (err, requestToken, requestSecret) {
    if (err) {
      console.log(err);
      res.status(500).send(err);
    }
    else {

      console.log("request token: " + requestToken)
      console.log("request secret: " + requestSecret)

      _requestSecret = requestSecret;
      res.redirect("https://api.twitter.com/oauth/authenticate?oauth_token=" + requestToken);
    }
  });

});

app.get("/access-token", function (req, res) {

  console.log("time to get the access token!")
  var requestToken = req.query.oauth_token;
  var verifier = req.query.oauth_verifier;

  console.log("oauth request token: " + requestToken)
  console.log("oauth verifier: " + verifier)


  twitterauth.getAccessToken(requestToken, _requestSecret, verifier, function (err, accessToken, accessSecret) {
    if (err)
      res.status(500).send(err);
    else {

      console.log("access token: " + accessToken)
      console.log("access Secret: " + accessSecret)

      twitterauth.verifyCredentials(accessToken, accessSecret, function (err, user) {
        if (err)
          res.status(500).send(err);
        else {
          var id = user.id;
          var screen_name = user.screen_name;
          var token = jwt.sign({ id: id, screen_name: screen_name }, jwtSecret, { expiresIn: 60 * 60 * 24 });

          readDocument(id.toString(), function (err, data) {
            if (err) {
              if (err.error === "not_found") {
                //create new user
                var newUser = { accessToken: accessToken, accessSecret: accessSecret, queries: [] }
                createDocument(id.toString(), newUser, function (err, data) {
                  if (err) {
                    console.log(err);
                    console.log("creation of a new user has failed");
                  } else {
                    console.log("created user")
                  }
                });
              } else {
                console.log(err); //weird error writting to DB
              }
            } else {
              console.log("user with id " + id.toString() + " already existed");
            }
          });
          res.redirect(baseURL + "?jwt=" + token);

        }
      });
    }
  });
});

app.post("/getResultsUser", function (req, res) {
  var userID = req.body.userID;
  //var userID = "271179985" //jose's userID
  //fetch access token from DB using userID key
  readDocument(userID, function (err, data) {
    if (err) {
      console.log("error occurred while reading user profile info")
      console.log(err);
      res.send(err); //error retrieving user data
    } else {

      res.send(data.whatsTweetingData.queries);
    }
  });
});

app.post("/getcloudstwitter", function (req, res) {
  var twitterHandle = req.body.twitterHandle;
  //clean up @s
  var MentionReg = new RegExp('@([^\\s]*)', 'g');
  twitterHandle = twitterHandle.replace(MentionReg, ""); //no @ mentions

  queryDocument(twitterHandle, function (error, data) {
    if (error) {
      res.send(error);
      return;
    }
    var resultUrls = { urls: [] };
    for (var i = 0; i < data.docs.length; i++) {
      var queries = data.docs[i].whatsTweetingData.queries;
      for (var j = 0; j < queries.length; j++) {
        if (queries[j].twitterHandle && queries[j].resultsURL) {
          if (queries[j].twitterHandle === twitterHandle) {
            resultUrls.urls.push(queries[j].resultsURL);
          }
        }
      }
    }
    res.send(resultUrls);
  });
});


app.post("/getresults", function (req, res) {
  var resultsID = req.body.resultsID;
  res.send({ resultsURL: baseURL + "/queryResults/" + resultsID });
});


app.post('/generateresults', function (req, res, next) {
  //var parameters = extend(req.body, { acceptLanguage: i18n.lng() }); //get rid after connect to real front end
  //console.log(parameters);


  //real paramenters, once connected to real front end
  var userID = req.body.userID;
  var numTweets = parseInt(req.body.numTweets);
  var twitterHandle = req.body.twitterHandle;
  var parameters = { recaptcha: '', text: req.text, language: 'en', acceptLanguage: i18n.lng() }

  //var userID = "271179985" //jose's userID for testing
  //var numTweets = 3200; //for testing 
  //var twitterHandle = parameters.text; //the handle of the user we're going to analyse, for testing


  //clean @ from handle
  var MentionReg = new RegExp('@([^\\s]*)', 'g');
  var twitterHandle = twitterHandle.replace(MentionReg, ""); //no @ mentions




  //fetch access token from DB using userID key
  readDocument(userID, function (err, data) {
    if (err) {
      console.log("error occurred while reading user profile info")
      console.log(err);
      res.send(err); //error retrieving user data
    } else {

      console.log(data);

      var access_token_key = data.whatsTweetingData.accessToken
      var access_token_secret = data.whatsTweetingData.accessSecret
      var pagenum = Math.floor(numTweets / 200) + 1;

      //set up twitter client for this request
      var client = new Twitter({
        consumer_key: consumer_key,
        consumer_secret: consumer_secret,
        access_token_key: access_token_key,
        access_token_secret: access_token_secret
      });

      getTweets(twitterHandle, pagenum, client, function (err, tweetsText) {
        parameters.text = tweetsText;
        var words = stringToWords(tweetsText); //for cloud generation
        console.log("obtained " + words.length + " words");

        if (words.length < 6000) {
          console.log("not enough words to generate personality profile, need at least 6000")
        }

        personalityInsights.profile(parameters, function (err, profile) {
          if (err)
            return next(err);
          else {

            genSVG(words, function (SVG) {
              //save results to DB (only URL to svg)
              var results = { profile: profile, wordcloud: SVG };

              var resultID = uuidV4();
              fs.writeFile(__dirname + "/queryResults/" + resultID + ".json", JSON.stringify(results), function (error) {
                if (error) {
                  console.error("write error:  " + error.message);
                } else {
                  console.log("Successful Write to " + __dirname);
                  data.whatsTweetingData.queries.push({ twitterHandle: twitterHandle, numTweets: numTweets, timestamp: new Date(), resultsURL: baseURL + "/queryResults/" + resultID, ID: resultID });
                  updateDocument(userID, data, function (err, data) {
                    if (err) {
                      console.log("error updating profile for user ID " + userID);
                      console.log(err);
                    } else {
                      console.log("successfully updated document for userID " + userID);
                    }
                  });
                }
              });

              return res.json({ profile: profile, wordcloud: SVG }); //return the results just generated
            });

          }
        });
      });

    }
  });

});


app.get("/getSVG", function (req, res) {
  var callback = function (svg) {
    res.send(svg);
  }
  var txt = 'How the Word Cloud Generator Works \
				The layout algorithm for positioning words without overlap is available on GitHub under an open source license as d3-cloud. \
				Note that this is the only the layout algorithm and any code for converting text into words and rendering the final output requires additional development. \
				As word placement can be quite #slow for more than a few hundred words, the layout algorithm can be run asynchronously, \
				with a configurable time step size. This makes it possible to animate words as they are placed without stuttering. It is \
				recommended to always use a time step even without animations as it prevents the browser’s event loop from blocking while placing the words. \
				The layout algorithm itself is incredibly simple. For each word, starting with the most "important": '
  var words = stringToWords(txt);
  //console.log(words);
  //var words = ["Hello", "Hello", "Hello", "Hello", "Hello", "Hello","world", "normally", "world","you", "want", "more","world", "world", "words", "than", "this"]
  genSVG(words, callback);
});

// error-handler settings
require('./config/error-handler')(app);
var port = process.env.PORT || process.env.VCAP_APP_PORT || 3000;


app.listen(port);
console.log('listening at:', port);


//svg functions
function calculateWordSizes(words) {
  words.sort();
  var prevWord = words[0];
  var countPrevWord = 1;
  var wordsWithCounts = [];
  for (var i = 1; i < words.length; i++) {
    if (words[i] == prevWord) {
      countPrevWord++;
    }
    else {
      wordsWithCounts.push({ text: prevWord, count: countPrevWord });
      prevWord = words[i];
      countPrevWord = 1;
    }

    if (i == words.length - 1)
      wordsWithCounts.push({ text: prevWord, count: countPrevWord });
  }
  var largestCount = -1;
  var smallestCount = Infinity;
  for (var i in wordsWithCounts) {
    if (wordsWithCounts[i].count > largestCount)
      largestCount = wordsWithCounts[i].count;
    if (wordsWithCounts[i].count < smallestCount)
      smallestCount = wordsWithCounts[i].count;
  }
  var smallestFont = 15;
  var largestFont = 100;
  var m = (largestFont - smallestFont) / (largestCount - smallestCount);
  var b = largestFont - (m * largestCount);
  for (var i in wordsWithCounts) {
    wordsWithCounts[i].size = (m * wordsWithCounts[i].count + b);
  }
  return wordsWithCounts;
}

function genSVG(words, callback) {

  wordsWithSizes = calculateWordSizes(words);


  var convertToSVGString = function (svgAttr) {
    var fill = d3Scale.scaleOrdinal(d3Scale.schemeCategory20);
    var svg = "";
    svg += "<svg width='720' height='500' version='1.1' xmlns='http://www.w3.org/2000/svg'>";
    svg += "<g transform='translate(480,250)'>";
    for (var i in svgAttr) {
      var text = svgAttr[i];
      svg += "<text text-anchor='middle' transform='translate(" + text.x + ","
        + text.y + ")rotate(" + text.rotate + ")' style='font-size: "
        + text.size + "px; font-family: Impact; fill: " + fill(i) + ";'>";
      svg += text.text;
      svg += "</text>"
    }
    svg += "</g>";
    svg += "</svg>";
    callback(svg);
  }

  cloud().size([720, 500])
    .canvas(function () { return new Canvas(1, 1); })
    .words(wordsWithSizes)
    .padding(5)
    .rotate(function () { return (Math.random() * 150) - 75; })
    .font("Impact")
    .fontSize(function (d) { return d.size; })
    .on("end", convertToSVGString)
    .start();
}

function stringToWords(string) {
  var lowerCaseTxt = string.toLowerCase();
  var words = lowerCaseTxt.split(/\s+/);
  if (words[words.length - 1] === "")
    words.pop();
  for (var i in words) {
    words[i] = words[i].replace(/[^0-9a-zA-Z#]/g, '');
  }
  return words;
}
