//'use strict';

var express = require('express');
var bodyParser = require('body-parser');
var watson = require('watson-developer-cloud');
var extend = require('util')._extend;
var i18n = require('i18next');
var Twitter = require('twitter');
// Load the full build.
var _ = require('lodash');

var app = express();

//set up body parser
app.use(bodyParser.urlencoded({ extended: true })); // support encoded bodies
app.use(bodyParser.json()); // support json encoded bodies


//i18n settings
require('./config/i18n')(app);

// Bootstrap application settings
require('./config/express')(app);







//set up twitter credenials (move creds to env variables later)
var client = new Twitter({
  consumer_key: 'nzHVwjmv85ctMPpF9rfS2OKxI',
  consumer_secret: 't7jEvPmxTHdFJ2OXW8Q4Qjq2cBMZVWYeTJIp5AzYP8dcRnqXJj',
  access_token_key: '271179985-pAZEB7odsPBLBMwmiYUxqGvDqrUvd9SElnCYZ7ex',
  access_token_secret: 'h8tJpf2L0nZswF3H5G0UkKrvyE0QZrkxvD3nNR2RQLhrn'
});




// Create the service wrapper
var personalityInsights = watson.personality_insights({
  version: 'v2',
  username: '<username>',
  password: '<password>'
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
            return { text: t.text, timestamp: new Date(t.created_at) };
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


app.post("/allTweets", function (req, res) {

  var totalTweets = { tweets: [], pagesAdded: 0 };

  res.setHeader('Content-Type', 'application/json');
  var userName = req.body.userName
  console.log("Tweets from " + userName)


  for (var i = 0; i < 16; i++) {
    getTweetsPerPage(i, userName, totalTweets).then(function (newTotalTweets) {



      if (newTotalTweets.pagesAdded === 16) {
        newTotalTweets.tweets = newTotalTweets.tweets.sort(function (a, b) {
          if (a.timestamp < b.timestamp) {
            return -1;
          } else
            return 1;
        });


        var noDups = _.uniqWith(newTotalTweets.tweets, _.isEqual);
        console.log("total tweets: " + noDups.length)
        res.send(noDups)
      }

    }).catch(function (error) {
      console.log(error);
    });
  }
});



app.post("/tweetsSearch", function (req, res) {
  res.setHeader('Content-Type', 'application/json');

  var userName = req.body.userName
  console.log("Tweets from " + userName)

  client.get('search/tweets', { q: "from:" + userName + " since:2016-03-29" }, function (error, tweet, response) {
    if (error) console.log(error);
    else {
      console.log(tweet);  // Tweet body. 
      //console.log(response);  // Raw response object.

      var tweetsOnly = tweet.statuses.map(function (t) { return { text: t.text, timestamp: t.created_at } });

      res.send(response)
    }
  });
});




app.post('/api/profile', function (req, res, next) {
  var parameters = extend(req.body, { acceptLanguage: i18n.lng() });

  personalityInsights.profile(parameters, function (err, profile) {
    if (err)
      return next(err);
    else
      return res.json(profile);
  });
});

// error-handler settings
require('./config/error-handler')(app);

var port = process.env.PORT || process.env.VCAP_APP_PORT || 3000;
app.listen(port);
console.log('listening at:', port);
