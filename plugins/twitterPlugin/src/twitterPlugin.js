"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const game_1 = require("@virtuals-protocol/game");
class TwitterPlugin {
    constructor(options) {
        this.id = options.id || "twitter_worker";
        this.name = options.name || "Twitter Worker";
        this.description =
            options.description ||
                "A worker that will execute tasks within the Twitter Social Platforms. It is capable of posting, reply, quote and like tweets.";
        this.twitterClient = options.twitterClient;
    }
    getWorker(data) {
        return new game_1.GameWorker({
            id: this.id,
            name: this.name,
            description: this.description,
            functions: (data === null || data === void 0 ? void 0 : data.functions) || [
                this.searchTweetsFunction,
                this.replyTweetFunction,
                this.postTweetFunction,
                this.likeTweetFunction,
                this.quoteTweetFunction,
            ],
            getEnvironment: (data === null || data === void 0 ? void 0 : data.getEnvironment) || this.getMetrics.bind(this),
        });
    }
    getMetrics() {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f;
            const result = yield this.twitterClient.me();
            return {
                followers: (_b = (_a = result.data.public_metrics) === null || _a === void 0 ? void 0 : _a.followers_count) !== null && _b !== void 0 ? _b : 0,
                following: (_d = (_c = result.data.public_metrics) === null || _c === void 0 ? void 0 : _c.following_count) !== null && _d !== void 0 ? _d : 0,
                tweets: (_f = (_e = result.data.public_metrics) === null || _e === void 0 ? void 0 : _e.tweet_count) !== null && _f !== void 0 ? _f : 0,
            };
        });
    }
    get searchTweetsFunction() {
        return new game_1.GameFunction({
            name: "search_tweets",
            description: "Search tweets",
            args: [{ name: "query", description: "The search query" }],
            executable: (args, logger) => __awaiter(this, void 0, void 0, function* () {
                try {
                    if (!args.query) {
                        return new game_1.ExecutableGameFunctionResponse(game_1.ExecutableGameFunctionStatus.Failed, "Query is required");
                    }
                    logger(`Searching for: ${args.query}`);
                    const tweets = yield this.twitterClient.search(args.query);
                    const feedbackMessage = "Tweets found:\n" +
                        JSON.stringify(tweets.data.map((tweet) => {
                            var _a, _b, _c;
                            return ({
                                tweetId: tweet.id,
                                content: tweet.text,
                                likes: (_a = tweet.public_metrics) === null || _a === void 0 ? void 0 : _a.like_count,
                                retweets: (_b = tweet.public_metrics) === null || _b === void 0 ? void 0 : _b.retweet_count,
                                replyCount: (_c = tweet.public_metrics) === null || _c === void 0 ? void 0 : _c.reply_count,
                            });
                        }));
                    logger(feedbackMessage);
                    return new game_1.ExecutableGameFunctionResponse(game_1.ExecutableGameFunctionStatus.Done, feedbackMessage);
                }
                catch (e) {
                    return new game_1.ExecutableGameFunctionResponse(game_1.ExecutableGameFunctionStatus.Failed, "Failed to search tweets");
                }
            }),
        });
    }
    get replyTweetFunction() {
        return new game_1.GameFunction({
            name: "reply_tweet",
            description: "Reply to a tweet where your think is the most interesting",
            args: [
                { name: "tweet_id", description: "The tweet id" },
                { name: "reply", description: "The reply content" },
                {
                    name: "reply_reasoning",
                    description: "The reasoning behind the reply",
                },
            ],
            executable: (args, logger) => __awaiter(this, void 0, void 0, function* () {
                try {
                    if (!args.tweet_id || !args.reply) {
                        return new game_1.ExecutableGameFunctionResponse(game_1.ExecutableGameFunctionStatus.Failed, "Tweet id and reply content are required");
                    }
                    logger(`Replying [${args.tweet_id}]: ${args.reply}`);
                    yield this.twitterClient.reply(args.tweet_id, args.reply);
                    return new game_1.ExecutableGameFunctionResponse(game_1.ExecutableGameFunctionStatus.Done, "Replied to tweet");
                }
                catch (e) {
                    return new game_1.ExecutableGameFunctionResponse(game_1.ExecutableGameFunctionStatus.Failed, "Failed to reply to tweet");
                }
            }),
        });
    }
    get postTweetFunction() {
        return new game_1.GameFunction({
            name: "post_tweet",
            description: "Post a tweet",
            args: [
                { name: "tweet", description: "The tweet content" },
                {
                    name: "tweet_reasoning",
                    description: "The reasoning behind the tweet",
                },
            ],
            executable: (args, logger) => __awaiter(this, void 0, void 0, function* () {
                try {
                    if (!args.tweet) {
                        return new game_1.ExecutableGameFunctionResponse(game_1.ExecutableGameFunctionStatus.Failed, "Tweet content is required");
                    }
                    logger(`Posting tweet: ${args.tweet}`);
                    yield this.twitterClient.post(args.tweet);
                    return new game_1.ExecutableGameFunctionResponse(game_1.ExecutableGameFunctionStatus.Done, "Tweet posted");
                }
                catch (e) {
                    return new game_1.ExecutableGameFunctionResponse(game_1.ExecutableGameFunctionStatus.Failed, "Failed to post tweet");
                }
            }),
        });
    }
    get likeTweetFunction() {
        return new game_1.GameFunction({
            name: "like_tweet",
            description: "Like a tweet. Choose this when you want to support a tweet quickly, without needing to comment.",
            args: [{ name: "tweet_id", description: "The tweet id" }],
            executable: (args, logger) => __awaiter(this, void 0, void 0, function* () {
                try {
                    if (!args.tweet_id) {
                        return new game_1.ExecutableGameFunctionResponse(game_1.ExecutableGameFunctionStatus.Failed, "Tweet id is required");
                    }
                    logger(`Liking tweet id: ${args.tweet_id}`);
                    yield this.twitterClient.like(args.tweet_id);
                    return new game_1.ExecutableGameFunctionResponse(game_1.ExecutableGameFunctionStatus.Done, "Tweet liked");
                }
                catch (e) {
                    return new game_1.ExecutableGameFunctionResponse(game_1.ExecutableGameFunctionStatus.Failed, "Failed to like tweet");
                }
            }),
        });
    }
    get quoteTweetFunction() {
        return new game_1.GameFunction({
            name: "quote_tweet",
            description: "Share someone else’s tweet while adding your own commentary. Use this when you want to provide your opinion, analysis, or humor on an existing tweet while still promoting the original content. This will help with your social presence.",
            args: [
                { name: "tweet_id", description: "The tweet id" },
                { name: "quote", description: "The quote content" },
            ],
            executable: (args, logger) => __awaiter(this, void 0, void 0, function* () {
                try {
                    if (!args.tweet_id || !args.quote) {
                        return new game_1.ExecutableGameFunctionResponse(game_1.ExecutableGameFunctionStatus.Failed, "Tweet id and quote content are required");
                    }
                    logger(`Quoting [${args.tweet_id}]: ${args.quote}`);
                    yield this.twitterClient.quote(args.tweet_id, args.quote);
                    return new game_1.ExecutableGameFunctionResponse(game_1.ExecutableGameFunctionStatus.Done, "Tweet quoted");
                }
                catch (e) {
                    return new game_1.ExecutableGameFunctionResponse(game_1.ExecutableGameFunctionStatus.Failed, "Failed to quote tweet");
                }
            }),
        });
    }
}
exports.default = TwitterPlugin;
