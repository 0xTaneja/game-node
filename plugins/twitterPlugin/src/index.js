"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameTwitterClient = exports.TwitterClient = void 0;
const twitterPlugin_1 = __importDefault(require("./twitterPlugin"));
const twitterClient_1 = require("./twitterClient");
Object.defineProperty(exports, "TwitterClient", { enumerable: true, get: function () { return twitterClient_1.TwitterClient; } });
const gameTwitterClient_1 = require("./gameTwitterClient");
Object.defineProperty(exports, "GameTwitterClient", { enumerable: true, get: function () { return gameTwitterClient_1.GameTwitterClient; } });
exports.default = twitterPlugin_1.default;
