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
exports.GameTwitterClient = void 0;
class GameTwitterClient {
    constructor(credential) {
        this.baseURL = "https://twitter.game.virtuals.io/tweets";
        this.headers = {
            "x-api-key": `${credential.accessToken}`,
        };
    }
    fetchAPI(endpoint, options) {
        return __awaiter(this, void 0, void 0, function* () {
            const response = yield fetch(`${this.baseURL}${endpoint}`, Object.assign(Object.assign({}, options), { headers: Object.assign({ "Content-Type": "application/json" }, this.headers) }));
            if (!response.ok) {
                throw new Error(`Error: ${response.statusText}`);
            }
            return response.json();
        });
    }
    fetchFormData(endpoint, options) {
        return __awaiter(this, void 0, void 0, function* () {
            const response = yield fetch(`${this.baseURL}${endpoint}`, Object.assign(Object.assign({}, options), { headers: this.headers }));
            if (!response.ok) {
                throw new Error(`Error: ${response.statusText}`);
            }
            return response.json();
        });
    }
    post(tweet, mediaIds) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.fetchAPI("/post", {
                method: "POST",
                body: JSON.stringify({ content: tweet, mediaIds }),
            });
        });
    }
    search(query) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.fetchAPI(`/search?query=${encodeURIComponent(query)}`, {
                method: "GET",
            });
        });
    }
    reply(tweetId, reply, mediaIds) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.fetchAPI(`/reply/${tweetId}`, {
                method: "POST",
                body: JSON.stringify({ content: reply, mediaIds }),
            });
        });
    }
    like(tweetId) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.fetchAPI(`/like/${tweetId}`, {
                method: "POST",
            });
        });
    }
    quote(tweetId, quote) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.fetchAPI(`/quote/${tweetId}`, {
                method: "POST",
                body: JSON.stringify({ content: quote }),
            });
        });
    }
    me() {
        return __awaiter(this, void 0, void 0, function* () {
            return this.fetchAPI("/me", {
                method: "GET",
            });
        });
    }
    mentions(paginationToken) {
        return __awaiter(this, void 0, void 0, function* () {
            let url = "/mentions";
            if (paginationToken) {
                url += `?paginationToken=${paginationToken}`;
            }
            return this.fetchAPI(url, {
                method: "GET",
            });
        });
    }
    followers(paginationToken) {
        return __awaiter(this, void 0, void 0, function* () {
            let url = "/followers";
            if (paginationToken) {
                url += `?paginationToken=${paginationToken}`;
            }
            return this.fetchAPI(url, {
                method: "GET",
            });
        });
    }
    following(paginationToken) {
        return __awaiter(this, void 0, void 0, function* () {
            let url = "/following";
            if (paginationToken) {
                url += `?paginationToken=${paginationToken}`;
            }
            return this.fetchAPI(url, {
                method: "GET",
            });
        });
    }
    uploadMedia(media) {
        return __awaiter(this, void 0, void 0, function* () {
            const formData = new FormData();
            formData.append("file", media);
            const result = yield this.fetchFormData(`/media`, {
                method: "POST",
                body: formData,
            });
            return result.mediaId;
        });
    }
}
exports.GameTwitterClient = GameTwitterClient;
