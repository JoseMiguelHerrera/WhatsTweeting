//'use strict';

var express = require('express');
var bodyParser = require('body-parser');
var watson = require('watson-developer-cloud');
var extend = require('util')._extend;
var i18n = require('i18next');
var Twitter = require('twitter');
var TwitterAuth = require("node-twitter-api");
var Canvas = require("canvas");
var cloud = require("./cloud");
var d3Scale = require("d3-scale");

var app = express();

//set up body parser
app.use(bodyParser.urlencoded({ extended: true })); // support encoded bodies
app.use(bodyParser.json()); // support json encoded bodies


//i18n settings
require('./config/i18n')(app);

// Bootstrap application settings
require('./config/express')(app);

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



//set up twitter credenials (move creds to env variables later)
var client = new Twitter({
  consumer_key: 'nzHVwjmv85ctMPpF9rfS2OKxI',
  consumer_secret: 't7jEvPmxTHdFJ2OXW8Q4Qjq2cBMZVWYeTJIp5AzYP8dcRnqXJj',
  access_token_key: '271179985-pAZEB7odsPBLBMwmiYUxqGvDqrUvd9SElnCYZ7ex',
  access_token_secret: 'h8tJpf2L0nZswF3H5G0UkKrvyE0QZrkxvD3nNR2RQLhrn'
});


var twitterauth = new TwitterAuth({
  consumerKey: 'nzHVwjmv85ctMPpF9rfS2OKxI',
  consumerSecret: 't7jEvPmxTHdFJ2OXW8Q4Qjq2cBMZVWYeTJIp5AzYP8dcRnqXJj',
  callback: "http://0.0.0.0:3000/loggedIn"
});

// Create the service wrapper
var personalityInsights = watson.personality_insights({
  version: 'v2',
  username: '5d14045a-3048-4a1f-ade8-c3e04d584a39',
  password: 'P0aXaZBQRx4T'
});

app.get('/', function (req, res) {
  res.render('index', { ct: req._csrfToken });
});


function getTweetsPerPage(page, userName, totalTweets) {

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


function getTweets(userName, pagenum, callback) {
  var totalTweets = { tweets: [], pagesAdded: 0 };

  //note max page =17 (3200 tweets)
  for (var i = 0; i < pagenum; i++) {
    getTweetsPerPage(i, userName, totalTweets).then(function (newTotalTweets) {
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


app.get("/loggedIn", function (req, res) {
  console.log("callback from twitter!");

  res.sendFile('/public/loggedin.html', { root: __dirname });
});



var _requestSecret; //why is this here, isn't it keeping some kind of state?
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
        else
        {
          console.log(user);
          res.send(user);
        }
      });
    }
  });



});



app.post("/allTweets", function (req, res) {
  res.setHeader('Content-Type', 'application/json');
  var userName = req.body.userName
  var pagenum = 5;

  getTweets(userName, pagenum, function (err, tweets) {
    res.send({ error: err, response: tweets });
  })

});


app.post('/api/profile', function (req, res, next) {
  var parameters = extend(req.body, { acceptLanguage: i18n.lng() });

  var userName = parameters.text;
  var pagenum = 17;

  getTweets(userName, pagenum, function (err, tweetsText) {
    parameters.text = tweetsText;
    personalityInsights.profile(parameters, function (err, profile) {
      if (err)
        return next(err);
      else
        return res.json(profile);
    });
  });

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
    svg += "<svg width='960' height='500' version='1.1' xmlns='http://www.w3.org/2000/svg'>";
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

  cloud().size([960, 500])
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
