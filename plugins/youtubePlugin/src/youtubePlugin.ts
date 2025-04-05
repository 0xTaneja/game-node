import { GameWorker,GameFunction,ExecutableGameFunctionResponse,ExecutableGameFunctionStatus } from "@virtuals-protocol/game";
import { youtubeClient,YoutubeChannel,YoutubeVideo } from "./youtubeClient";

import * as storage from "../db/storage";

import TwitterPlugin from "../../twitterPlugin/src/twitterPlugin";

interface IYoutubePluginOptions{
    id?:string;
    name?:string;
    description?:string;
    youtubeClient:youtubeClient;
    twitterPlugin?:TwitterPlugin;
}

class YoutubePlugin{
    private id:string;
    private name:string;
    private description:string;
    private youtubeClient:youtubeClient;
    private twitterPlugin?:TwitterPlugin;
    constructor(options:IYoutubePluginOptions){
        this.id = options.id ||"youtube_worker";
        this.name = options.name || "Youtube Worker";
        this.description = options.description || "A worker that tracks YouTube channels, analyzes trends, and monitors creator growth";
        this.youtubeClient = options.youtubeClient;
        this.twitterPlugin = options.twitterPlugin;
    }

    public getWorker(data?: {
        functions?: GameFunction<any>[];
        getEnvironment?: () => Promise<Record<string, any>>;
      }): GameWorker {
        return new GameWorker({
          id: this.id,
          name: this.name,
          description: this.description,
          functions: data?.functions || [
            this.searchChannelsFunction,
            this.trackChannelFunction,
            this.getTrackedChannelsFunction,
            this.getChannelMetricsFunction,
            this.getTrendingVideosFunction,
          ],
          getEnvironment: data?.getEnvironment || this.getMetrics.bind(this),
        });
      }

      public async getMetrics() {
        // Get all tracked channels
        const channels = await storage.getAllTrackedChannels();
        
        return {
          trackedChannels: channels.length,
          // Add more metrics as needed
        };
      }

      get searchChannelsFunction() {
        return new GameFunction({
          name: "search_channels",
          description: "Search for YouTube channels by query",
          args: [{ 
            name: "query", 
            description: "The search query for finding channels" 
          }] as const,
          executable: async (args, logger) => {
            try {
              if (!args.query) {
                return new ExecutableGameFunctionResponse(
                  ExecutableGameFunctionStatus.Failed,
                  "Query is required"
                );
              }
      
              logger(`Searching for channels: ${args.query}`);
      
              const channels = await this.youtubeClient.searchChannels(args.query);
      
              const feedbackMessage = 
                "Channels found:\n" +
                JSON.stringify(
                  channels.map(channel => ({
                    channelId: channel.id,
                    title: channel.title,
                    subscribers: channel.statistics.subscriberCount,
                    views: channel.statistics.viewCount
                  }))
                );
      
              logger(feedbackMessage);
      
              return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                feedbackMessage
              );
            } catch (e) {
              const errorMessage = e instanceof Error ? e.message : "Unknown error";
              return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to search channels: ${errorMessage}`
              );
            }
          },
        });
      }

      get trackChannelFunction() {
        return new GameFunction({
          name: "track_channel",
          description: "Start tracking a YouTube channel",
          args: [{ 
            name: "channel_id", 
            description: "The channel ID to track" 
          }] as const,
          executable: async (args, logger) => {
            try {
              if (!args.channel_id) {
                return new ExecutableGameFunctionResponse(
                  ExecutableGameFunctionStatus.Failed,
                  "Channel ID is required"
                );
              }
      
              logger(`Starting to track channel: ${args.channel_id}`);
      
              // First check if the channel already exists in our DB
              let channel = await storage.getChannel(args.channel_id);
              
              if (channel) {
                return new ExecutableGameFunctionResponse(
                  ExecutableGameFunctionStatus.Done,
                  `Channel ${channel.name} is already being tracked`
                );
              }
              
              // Fetch channel info from YouTube
              const channelInfo = await this.youtubeClient.getChannel(args.channel_id);
              
              if (!channelInfo) {
                return new ExecutableGameFunctionResponse(
                  ExecutableGameFunctionStatus.Failed,
                  `Could not find channel with ID: ${args.channel_id}`
                );
              }
              
              // Create metrics from channel info
              const metrics = {
                subscribers: channelInfo.statistics.subscriberCount,
                views: channelInfo.statistics.viewCount,
                likes: 0, // Will be updated in the background
                lastVideoId: '',
                lastVideoTimestamp: Date.now(),
                lastChecked: Date.now()
              };
              
              // Store in database
              await storage.createChannel(channelInfo.id, channelInfo.title, metrics);
              
              // Optionally post to Twitter
              if (this.twitterPlugin) {
                await this.twitterPlugin.postTweetFunction.executable({
                  tweet: `Started tracking YouTube channel "${channelInfo.title}"! Will monitor growth and notify about significant changes.`,
                  tweet_reasoning: "Announcing new channel tracking to followers"
                }, logger);
              }
      
              return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                `Now tracking channel: ${channelInfo.title}`
              );
            } catch (e) {
              const errorMessage = e instanceof Error ? e.message : "Unknown error";
              return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to track channel: ${errorMessage}`
              );
            }
          },
        });
      }

      // Add missing function - Get all tracked channels
      get getTrackedChannelsFunction() {
        return new GameFunction({
          name: "get_tracked_channels",
          description: "Get a list of all channels being tracked",
          args: [] as const,
          executable: async (args, logger) => {
            try {
              logger("Fetching all tracked channels...");
              
              const channels = await storage.getAllTrackedChannels();
              
              if (channels.length === 0) {
                return new ExecutableGameFunctionResponse(
                  ExecutableGameFunctionStatus.Done,
                  "No channels are currently being tracked."
                );
              }
              
              const channelList = channels.map(channel => ({
                id: channel.channelId,
                name: channel.name,
                subscribers: channel.metrics.subscribers,
                views: channel.metrics.views,
                lastChecked: new Date(channel.metrics.lastChecked).toISOString()
              }));
              
              const feedbackMessage = `Currently tracking ${channels.length} channels:\n${JSON.stringify(channelList, null, 2)}`;
              
              logger(feedbackMessage);
              
              return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                feedbackMessage
              );
            } catch (e) {
              const errorMessage = e instanceof Error ? e.message : "Unknown error";
              return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch tracked channels: ${errorMessage}`
              );
            }
          }
        });
      }
      
      // Add missing function - Get channel metrics
      get getChannelMetricsFunction() {
        return new GameFunction({
          name: "get_channel_metrics",
          description: "Get detailed metrics for a specific channel",
          args: [{ 
            name: "channel_id", 
            description: "The ID of the channel to get metrics for" 
          }] as const,
          executable: async (args, logger) => {
            try {
              if (!args.channel_id) {
                return new ExecutableGameFunctionResponse(
                  ExecutableGameFunctionStatus.Failed,
                  "Channel ID is required"
                );
              }
              
              logger(`Fetching metrics for channel: ${args.channel_id}`);
              
              // Get current data from database
              const channelData = await storage.getChannel(args.channel_id);
              
              if (!channelData) {
                return new ExecutableGameFunctionResponse(
                  ExecutableGameFunctionStatus.Failed,
                  `Channel with ID ${args.channel_id} is not being tracked`
                );
              }
              
              // Get fresh data from YouTube
              const latestData = await this.youtubeClient.getChannel(args.channel_id);
              
              if (!latestData) {
                return new ExecutableGameFunctionResponse(
                  ExecutableGameFunctionStatus.Failed,
                  `Could not fetch current data for channel ${channelData.name}`
                );
              }
              
              // Calculate growth metrics
              const subscriberGrowth = latestData.statistics.subscriberCount - channelData.metrics.subscribers;
              const viewGrowth = latestData.statistics.viewCount - channelData.metrics.views;
              
              // Get latest videos
              const latestVideos = await this.youtubeClient.getLatestVideos(args.channel_id, 3);
              
              // Format response
              const metricsReport = {
                channelName: channelData.name,
                currentMetrics: {
                  subscribers: latestData.statistics.subscriberCount,
                  views: latestData.statistics.viewCount,
                  videos: latestData.statistics.videoCount
                },
                growth: {
                  subscribers: subscriberGrowth,
                  subscriberPercentage: channelData.metrics.subscribers > 0 ? 
                    (subscriberGrowth / channelData.metrics.subscribers * 100).toFixed(2) + '%' : 'N/A',
                  views: viewGrowth,
                  viewPercentage: channelData.metrics.views > 0 ? 
                    (viewGrowth / channelData.metrics.views * 100).toFixed(2) + '%' : 'N/A'
                },
                latestVideos: latestVideos.map(video => ({
                  title: video.title,
                  published: new Date(video.publishedAt).toISOString(),
                  views: video.statistics.viewCount,
                  likes: video.statistics.likeCount
                })),
                lastUpdated: new Date(channelData.metrics.lastChecked).toISOString()
              };
              
              // Update channel metrics in database with latest data
              const updatedMetrics = {
                subscribers: latestData.statistics.subscriberCount,
                views: latestData.statistics.viewCount,
                likes: channelData.metrics.likes, // Keep existing likes data
                lastVideoId: channelData.metrics.lastVideoId, // Keep existing last video ID
                lastVideoTimestamp: channelData.metrics.lastVideoTimestamp,
                lastChecked: Date.now()
              };
              
              await storage.updateChannelMetrics(args.channel_id, updatedMetrics);
              
              const feedbackMessage = `Channel metrics for ${channelData.name}:\n${JSON.stringify(metricsReport, null, 2)}`;
              
              logger(feedbackMessage);
              
              return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                feedbackMessage
              );
            } catch (e) {
              const errorMessage = e instanceof Error ? e.message : "Unknown error";
              return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch channel metrics: ${errorMessage}`
              );
            }
          }
        });
      }
      
      // Add missing function - Get trending videos
      get getTrendingVideosFunction() {
        return new GameFunction({
          name: "get_trending_videos",
          description: "Get the current trending videos on YouTube",
          args: [{ 
            name: "region_code", 
            description: "The region code to get trending videos for (default: US)" 
          }] as const,
          executable: async (args, logger) => {
            try {
              const regionCode = args.region_code || 'US';
              
              logger(`Fetching trending videos for region: ${regionCode}`);
              
              const trendingVideos = await this.youtubeClient.getTrendingVideos(regionCode, 10);
              
              if (trendingVideos.length === 0) {
                return new ExecutableGameFunctionResponse(
                  ExecutableGameFunctionStatus.Done,
                  `No trending videos found for region ${regionCode}`
                );
              }
              
              const videoList = trendingVideos.map(video => ({
                title: video.title,
                channel: video.channelTitle,
                views: video.statistics.viewCount,
                likes: video.statistics.likeCount,
                comments: video.statistics.commentCount,
                url: `https://www.youtube.com/watch?v=${video.id}`
              }));
              
              const feedbackMessage = `Top trending videos for ${regionCode}:\n${JSON.stringify(videoList, null, 2)}`;
              
              logger(feedbackMessage);
              
              return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                feedbackMessage
              );
            } catch (e) {
              const errorMessage = e instanceof Error ? e.message : "Unknown error";
              return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch trending videos: ${errorMessage}`
              );
            }
          }
        });
      }
}

export { YoutubePlugin };