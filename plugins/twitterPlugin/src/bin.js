#!/usr/bin/env node
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
const axios_1 = __importDefault(require("axios"));
const commander_1 = require("commander");
const http_1 = __importDefault(require("http"));
const open_1 = __importDefault(require("open"));
const client = axios_1.default.create({
    baseURL: "https://twitter.game.virtuals.io/accounts",
});
const getLoginUrl = (apiKey) => __awaiter(void 0, void 0, void 0, function* () {
    const response = yield client.get("/auth", {
        headers: {
            "x-api-key": apiKey,
        },
    });
    return response.data.url;
});
const verify = (code, state) => __awaiter(void 0, void 0, void 0, function* () {
    const response = yield client.get("/verify", {
        params: {
            code,
            state,
        },
    });
    return response.data.token;
});
const program = new commander_1.Command();
program
    .name("game-twitter-plugin")
    .description("CLI to authenticate and interact with GAME's Twitter API")
    .version("0.1.0");
program
    .command("auth")
    .description("Authenticate with Twitter API")
    .option("-k, --key <char>", "project's API key")
    .action((options) => {
    const apiKey = options.key;
    if (!apiKey) {
        console.error("API key is required!");
        return;
    }
    const server = http_1.default.createServer((req, res) => __awaiter(void 0, void 0, void 0, function* () {
        var _a;
        if (req.method === "GET" && ((_a = req.url) === null || _a === void 0 ? void 0 : _a.startsWith("/callback"))) {
            const query = new URLSearchParams(req.url.split("?")[1]);
            const code = query.get("code");
            const state = query.get("state");
            const token = yield verify(code, state);
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.end("Authentication successful! You may close this window and return to the terminal.");
            console.log("Authenticated! Here's your access token:");
            console.log(token);
            console.log("\n");
            server.close();
        }
        else {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Not Found");
        }
    }));
    server.listen(8714, () => __awaiter(void 0, void 0, void 0, function* () {
        const url = yield getLoginUrl(apiKey);
        console.log("\nWaiting for authentication...\n");
        console.log("Visit the following URL to authenticate:");
        console.log(url, "\n");
        yield (0, open_1.default)(url);
    }));
});
program.parse();
