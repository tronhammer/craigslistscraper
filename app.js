var request = require("request"),
	jsdom = require("jsdom"),
	mongoose = require('mongoose'),
	nodemailer = require("nodemailer"),
	Q = require("q");

var urls = [
	"santabarbara.craigslist.org/search/sss?query=weight+bench&zoomToPosting=&minAsk=&maxAsk=200&hasPic=1&srchType=T"
];
var smtpTransport = nodemailer.createTransport("SMTP",{
	service: "Gmail",
	auth: {
		user: "smurraysb@gmail.com",
		pass: "*****"
	}
});

var digestHTMLCreator = function(entry, html){
	return (html + '<br/><a href="santabarbara.craigslist.org/'+entry.uri+'">'+entry.name+'</a> for $'+entry.price);
};

mongoose.connect('mongodb://localhost/cls');

var db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', function callback () {
	var listingSchema = mongoose.Schema({
		name: String,
		price: Number,
		uri: String,
		
	});

	var LastListing = mongoose.model('LastListing', listingSchema),
		Digest = mongoose.model('Digest', listingSchema);
	
	// query = LastListing.remove();
	// query.exec();
	
	Digest.remove(function(){
		var reqQueue = [],
			saveQueue = [];

		// A standard NodeJS function: a parameter and a callback; the callback
		// will return error (if any) as first parameter and result as second
		// parameter.
		var fetchUrl = function(url, callback) {
			var deferred = Q.defer();
			request({
				  url: 'http://' + url
			}, function(err, response, body){
				//Just a basic error check
				if(err && response.statusCode !== 200){
					console.log('Request error.');
				}

				jsdom.env(
					body,
					["http://code.jquery.com/jquery.js"],
					function (errors, window) {
						var $ = window.$;
						
						LastListing.find(function(err, lasts){
							var last = lasts[0];
							
							$(".pl").each(function(i){
								var href = $(this).find("a").attr("href").trim();
								
								if (last && href == last.uri){
									return false; //break
								}
								
								if (!i){
									var query = LastListing.remove();
									query.exec();
									var newLast = new LastListing({
										uri: href
									});
									newLast.save();
								}
								
								var price = +$(this).siblings(".l2").find(".price").text().substr(1);
								if (price){
									var title = $(this).find("a").text();
									var digest = new Digest({
										uri: href,
										name: title,
										price: price
									});
									
									var saver = function(digest){
										var deferredSave = Q.defer();
										digest.save(function(){
											deferredSave.resolve(true);
										});
										return deferredSave.promise;
									}
									
									saveQueue.push(saver(digest));
								}
								
							});
							
							deferred.resolve(body.headers);
						});
						
					}
				);
			});
			
			return deferred.promise;
		};
		
		// For each url, create a function call and addit to the queue ;)
		urls.forEach(function(url) {
			reqQueue.push(fetchUrl(url));
		});
	
		Q.all(reqQueue).then(function(ful) {
		}, function(rej) {
		}).fail(function(err) {
		}).fin(function(){
			Q.all(saveQueue).fin(function(){
				Digest.find(function(err, digest){

					
					if (digest.length){
						// setup e-mail data with unicode symbols
						var mailOptions = {
							from: "Craigslist Scraper <cls@tronnet.me>", // sender address
							to: "smurraysb@gmail.com", // list of receivers
							subject: "Craigslist Digest", // Subject line
							text: "Here is your digest! ", // plaintext body
							html: "Here is your digest! " // html body
						}
						
						digest.forEach(function(entry){
							mailOptions.html = digestHTMLCreator(entry, mailOptions.html);
						});
						digest.forEach(function(entry){
							mailOptions.text = digestHTMLCreator(entry, mailOptions.text);
						});
					
						// send mail with defined transport object
						smtpTransport.sendMail(mailOptions, function(error, response){
							if(error){
								console.log(error);
							}else{
								console.log("Message sent: " + response.message);
							}
							
							Digest.remove(function(){
								mongoose.disconnect();
								smtpTransport.close(); // shut down the connection pool, no more messages
							});
						});
					} else {
						console.log("NOTHING NEW");
						Digest.remove(function(){
							mongoose.disconnect();
							smtpTransport.close(); // shut down the connection pool, no more messages
						});
					}
				})
			})
		});
		
	})
});