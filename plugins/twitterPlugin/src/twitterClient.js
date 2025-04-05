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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TwitterClient = void 0;
const twitter_api_v2_1 = __importDefault(require("twitter-api-v2"));
class TwitterClient {
    constructor(credential) {
        this.twitterClient = new twitter_api_v2_1.default({
            appKey: credential.apiKey,
            appSecret: credential.apiSecretKey,
            accessToken: credential.accessToken,
            accessSecret: credential.accessTokenSecret,
        });
    }
    get client() {
        return this.twitterClient;
    }
    post(tweet) {
        return this.twitterClient.v2.tweet(tweet);
    }
    search(query) {
        return __awaiter(this, void 0, void 0, function* () {
            const response = yield this.twitterClient.v2.search(query, {
                max_results: 10,
                "tweet.fields": ["public_metrics"],
            });
            return response.data;
        });
    }
    reply(tweetId, reply) {
        return this.twitterClient.v2.reply(reply, tweetId);
    }
    like(tweetId) {
        return __awaiter(this, void 0, void 0, function* () {
            const me = yield this.twitterClient.v2.me();
            return this.twitterClient.v2.like(me.data.id, tweetId);
        });
    }
    quote(tweetId, quote) {
        return this.twitterClient.v2.quote(quote, tweetId);
    }
    me() {
        return this.twitterClient.v2.me({
            "user.fields": ["public_metrics"],
        });
    }
    mentions(paginationToken) {
        return __awaiter(this, void 0, void 0, function* () {
            const me = yield this.twitterClient.v2.me();
            const options = {};
            if (paginationToken) {
                options.pagination_token = paginationToken;
            }
            const response = yield this.twitterClient.v2.userMentionTimeline(me.data.id, options);
            return response.data;
        });
    }
    followers(paginationToken) {
        return __awaiter(this, void 0, void 0, function* () {
            const me = yield this.twitterClient.v2.me();
            const options = {};
            if (paginationToken) {
                options.pagination_token = paginationToken;
            }
            const response = yield this.twitterClient.v2.followers(me.data.id, options);
            return response;
        });
    }
    following(paginationToken) {
        return __awaiter(this, void 0, void 0, function* () {
            const me = yield this.twitterClient.v2.me();
            const options = {};
            if (paginationToken) {
                options.pagination_token = paginationToken;
            }
            const response = yield this.twitterClient.v2.following(me.data.id, options);
            return response;
        });
    }
    uploadMedia(media) {
        return __awaiter(this, void 0, void 0, function* () {
            const mediaBuffer = Buffer.from(yield media.arrayBuffer());
            const response = yield this.twitterClient.v2.uploadMedia(mediaBuffer, {
                media_type: media.type,
            });
            return response;
        });
    }
}
exports.TwitterClient = TwitterClient;
