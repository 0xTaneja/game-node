import { YoutubeChannel, YoutubeVideo, youtubeClient } from './youtubeClient';
import TwitterPlugin from '../../twitterPlugin/src/twitterPlugin';
import * as storage from '../db/storage';
import { TweetFormatter } from './tweetFormatter';
import { AIResponseGenerator } from './aiResponseGenerator';
import { AnalyticService } from './analyticService';
import { PluginState } from './youtubePlugin';
import { ExecutableGameFunctionStatus } from "@virtuals-protocol/game";

/**
 * Scheduler for YouTube monitoring tasks
 * Handles periodic checking of metrics, trending creators, and cleanup
 */
export class YoutubeScheduler {
    private youtubeClient: youtubeClient;
    private twitterPlugin?: TwitterPlugin;
    private trendingCheckInterval: NodeJS.Timeout | null = null;
    private metricsCheckInterval: NodeJS.Timeout | null = null;
    private lastTrendingUpdate: number = 0;
    private postedVideoIds: Set<string> = new Set();
    private _isRunning: boolean = false;
    private totalTweetsSent: number = 0;
    private onStateUpdate?: (state: Partial<PluginState>) => void;
    private topCreators: string[] = [];
    
    /**
     * Create a new YouTube scheduler
     * @param client YouTube API client
     * @param twitterPlugin Optional Twitter plugin for posting updates
     * @param onStateUpdate Optional state update function
     */
    constructor(
        client: youtubeClient, 
        twitterPlugin?: TwitterPlugin,
        onStateUpdate?: (state: Partial<PluginState>) => void
    ) {
        this.youtubeClient = client;
    this.twitterPlugin = twitterPlugin;
        this.onStateUpdate = onStateUpdate;
    }
    
    /**
     * Start the scheduler
     */
    public start(): void {
        console.log("Starting YouTube scheduler...");
        
        if (this._isRunning) {
            console.log("Scheduler is already running!");
            return;
        }
        
        this._isRunning = true;
        
        // Connect to database
        storage.connectDB().then(() => {
            console.log("Database connected successfully!");
            
            // Immediately run initial trending check
            this.getTrendingCreators().catch((err: Error) => {
                console.error("Error in initial trending check:", err);
            });
            
            // Schedule regular trending check (every 24 hours)
            this.trendingCheckInterval = setInterval(() => {
                this.getTrendingCreators().catch((err: Error) => {
                    console.error("Error in scheduled trending check:", err);
                });
            }, 24 * 60 * 60 * 1000); // 24 hours
            
            // Schedule regular metrics check (every 15 minutes)
            this.metricsCheckInterval = setInterval(() => {
                this.checkAllChannelMetrics().catch((err: Error) => {
                    console.error("Error in scheduled metrics check:", err);
                });
            }, 15 * 60 * 1000); // 15 minutes
            
            console.log("Scheduler started successfully!");

            // Update state with running status
            this.updateState({
                isMonitoring: true
            });
        }).catch(err => {
            console.error("Failed to connect to database:", err);
        });
    }
    
    /**
     * Stop the scheduler
     */
    public stop(): void {
        console.log("Stopping YouTube scheduler...");
        
        if (!this._isRunning) {
            console.log("Scheduler is not running!");
            return;
        }
        
        if (this.trendingCheckInterval) {
            clearInterval(this.trendingCheckInterval);
            this.trendingCheckInterval = null;
        }
        
        if (this.metricsCheckInterval) {
            clearInterval(this.metricsCheckInterval);
            this.metricsCheckInterval = null;
        }
        
        this._isRunning = false;
        console.log("Scheduler stopped successfully!");

        // Update state with stopped status
        this.updateState({
            isMonitoring: false
        });
    }
    
    /**
     * Check metrics for all tracked channels
     */
    private async checkAllChannelMetrics(): Promise<void> {
        try {
            console.log("Checking metrics for all tracked channels...");
            
            // Get tracked channels from database
            const channels = await storage.getAllTrackedChannels();
            
            console.log(`Found ${channels.length} tracked channels to check`);
            
            if (channels.length === 0) {
                console.log("No channels being tracked, will try again later");
                return;
            }
            
            // Update state with channel count
            this.updateState({
                trackedChannels: channels.length
            });
            
            // Check channels based on their tier
            const now = new Date();
            const currentHour = now.getHours();
            
            // Process tier 1 channels (every check)
            const tier1Channels = channels.filter(c => c.monitoringTier === 1);
            if (tier1Channels.length > 0) {
                console.log(`Checking ${tier1Channels.length} Tier 1 channels`);
                await this.processChannels(tier1Channels);
            }
            
            // Process tier 2 channels every 2 hours
            if (currentHour % 2 === 0) {
                const tier2Channels = channels.filter(c => c.monitoringTier === 2);
                if (tier2Channels.length > 0) {
                    console.log(`Checking ${tier2Channels.length} Tier 2 channels`);
                    await this.processChannels(tier2Channels);
                }
            }
            
            // Process tier 3 channels once a day
            if (currentHour === 0) {
                const tier3Channels = channels.filter(c => c.monitoringTier === 3);
                if (tier3Channels.length > 0) {
                    console.log(`Checking ${tier3Channels.length} Tier 3 channels`);
                    await this.processChannels(tier3Channels);
                }
            }
            
            // Clean up expired channels
            await this.cleanupExpiredChannels();
            
        } catch (error) {
            console.error("Error checking channel metrics:", error);
            throw error;
        }
    }
    
    /**
     * Process metrics for a list of channels
     */
    private async processChannels(channels: any[]): Promise<void> {
        console.log(`===== Processing ${channels.length} channels at ${new Date().toISOString()} =====`);
        
        let channelsProcessed = 0;
        let significantChangesDetected = 0;
        let tweetsPosted = 0;
        let newVideosDetected = 0;
        let errors = 0;
        
        for (const channel of channels) {
            try {
                console.log(`\nProcessing channel: ${channel.name} (${channel.channelId})`);
                console.log(`Channel monitoring tier: ${channel.monitoringTier}`);
                console.log(`Last checked: ${new Date(channel.metrics.lastChecked).toISOString()}`);
                
                // Get fresh channel data
                let channelData;
                try {
                    channelData = await this.youtubeClient.getChannel(channel.channelId);
                    if (!channelData) {
                        console.log(`Could not fetch data for channel ${channel.name} - API may be rate limited`);
                        continue;
                    }
                } catch (fetchError) {
                    console.error(`Error fetching channel data: ${fetchError}`);
                    errors++;
                    continue;
                }
                
                // Get total likes - with error handling
                let totalLikes = 0;
                try {
                    totalLikes = await this.youtubeClient.getTotalChannelLikes(channel.channelId);
                } catch (likesError) {
                    console.error(`Error fetching total likes: ${likesError}`);
                    // Continue with existing likes data if available
                    totalLikes = channel.metrics.likes || 0;
                }
                
                // Calculate metrics changes
                const oldMetrics = channel.metrics;
                const newMetrics = {
                    subscribers: channelData.statistics.subscriberCount,
                    views: channelData.statistics.viewCount,
                    likes: totalLikes,
                    lastVideoId: oldMetrics.lastVideoId,
                    lastVideoTimestamp: oldMetrics.lastVideoTimestamp,
                    lastChecked: Date.now()
                };
                
                // Calculate changes for logging
                const subscriberChangePercent = ((newMetrics.subscribers - oldMetrics.subscribers) / (oldMetrics.subscribers || 1)) * 100;
                const viewsChangePercent = ((newMetrics.views - oldMetrics.views) / (oldMetrics.views || 1)) * 100;
                const likesChangePercent = ((newMetrics.likes - oldMetrics.likes) / (oldMetrics.likes || 1)) * 100;
                
                console.log(`Metrics changes:
- Subscribers: ${oldMetrics.subscribers.toLocaleString()} → ${newMetrics.subscribers.toLocaleString()} (${subscriberChangePercent > 0 ? '+' : ''}${subscriberChangePercent.toFixed(3)}%)
- Views: ${oldMetrics.views.toLocaleString()} → ${newMetrics.views.toLocaleString()} (${viewsChangePercent > 0 ? '+' : ''}${viewsChangePercent.toFixed(3)}%)
- Likes: ${oldMetrics.likes.toLocaleString()} → ${newMetrics.likes.toLocaleString()} (${likesChangePercent > 0 ? '+' : ''}${likesChangePercent.toFixed(3)}%)`);
                
                // Check for significant changes using adaptive thresholds
                const subsThreshold = storage.getAdaptiveThreshold('SUBS_CHANGE', newMetrics.subscribers);
                const viewsThreshold = storage.getAdaptiveThreshold('VIEWS_CHANGE', newMetrics.views);
                const likesThreshold = storage.getAdaptiveThreshold('LIKES_CHANGE', newMetrics.likes);
                
                console.log(`Adaptive thresholds:
- Subscribers: ${(subsThreshold * 100).toFixed(3)}%
- Views: ${(viewsThreshold * 100).toFixed(3)}%
- Likes: ${(likesThreshold * 100).toFixed(3)}%`);
                
                const subsChangeRatio = Math.abs(subscriberChangePercent / 100);
                const viewsChangeRatio = Math.abs(viewsChangePercent / 100);
                const likesChangeRatio = Math.abs(likesChangePercent / 100);
                
                const isSignificantSubs = subsChangeRatio > subsThreshold;
                const isSignificantViews = viewsChangeRatio > viewsThreshold;
                const isSignificantLikes = likesChangeRatio > likesThreshold;
                
                const hasSignificantChange = isSignificantSubs || isSignificantViews || isSignificantLikes;
                
                console.log(`Significant change detected: ${hasSignificantChange ? 'YES' : 'NO'}`);
                if (hasSignificantChange) {
                    console.log(`Which metrics changed significantly:
- Subscribers: ${isSignificantSubs ? 'YES' : 'NO'}
- Views: ${isSignificantViews ? 'YES' : 'NO'}
- Likes: ${isSignificantLikes ? 'YES' : 'NO'}`);
                    
                    significantChangesDetected++;
                }
                
                // Update metrics in database
                try {
                    await storage.updateChannelMetrics(channel.channelId, newMetrics);
                    console.log(`Updated metrics in database for ${channel.name}`);
                    channelsProcessed++;
                } catch (updateError) {
                    console.error(`Failed to update metrics in database: ${updateError}`);
                    errors++;
                    continue;
                }
                
                // Determine time since last post for this channel
                const lastPostedAt = channel.lastPostedAt || 0;
                const now = Date.now();
                const timeSinceLastPost = now - lastPostedAt;
                const hoursElapsed = timeSinceLastPost / (1000 * 60 * 60);
                
                // Determine appropriate post interval based on channel tier and size
                let minHoursForPost = 6; // Default: 6 hours between posts
                
                // Adjust based on tier (higher tier = less frequent posts)
                if (channel.monitoringTier === 1) {
                    minHoursForPost = 4; // Post more often for trending creators
                } else if (channel.monitoringTier === 3) {
                    minHoursForPost = 12; // Post less often for less trending creators
                }
                
                // Adjust based on subscriber count
                if (newMetrics.subscribers > 10000000) {
                    minHoursForPost *= 0.75; // Post more often for very large channels
                } else if (newMetrics.subscribers < 100000) {
                    minHoursForPost *= 1.25; // Post less often for smaller channels
                }
                
                console.log(`Time since last post: ${hoursElapsed.toFixed(1)} hours (minimum: ${minHoursForPost} hours)`);
                
                // Post metrics update if significant changes detected and enough time has passed
                if (hasSignificantChange && hoursElapsed >= minHoursForPost) {
                    try {
                        console.log(`Posting metrics update for ${channelData.title} to Twitter...`);
                        
                        // Format and post tweet
                        const tweetText = TweetFormatter.formatMetricsUpdateTweet(
                            channelData,
                            oldMetrics,
                            newMetrics
                        );
                        
                        const tweetSent = await this.sendTweet(
                            tweetText,
                            `Posting update for ${channelData.title} - significant changes detected`
                        );
                        
                        console.log(`Metrics update for ${channelData.title} was ${tweetSent ? 'successfully posted' : 'not posted'} to Twitter`);
                        
                        if (tweetSent) {
                            tweetsPosted++;
                        }
                        
                        // Store the last posted timestamp in memory for rate limiting
                        channel.lastPostedAt = now;
                        
                        // We can't directly update lastPostedAt as it's not in the schema
                        // But we can update the channel directly in memory for rate limiting purposes
                    } catch (error) {
                        console.error(`Error posting metrics update for ${channelData.title}:`, error);
                        errors++;
                    }
                } else if (hasSignificantChange) {
                    console.log(`Significant changes for ${channelData.title} detected, but waiting for time threshold (posted ${hoursElapsed.toFixed(1)} hours ago, minimum: ${minHoursForPost} hours)`);
                }
                
                // Check for new videos
                try {
                    const newVideoDetected = await this.checkForNewVideos(channel);
                    if (newVideoDetected) {
                        newVideosDetected++;
                    }
                } catch (videoError) {
                    console.error(`Error checking for new videos: ${videoError}`);
                    errors++;
                }
                
                // Add a small delay between channels to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (error) {
                console.error(`Error processing channel ${channel.name}:`, error);
                errors++;
            }
        }
        
        console.log(`\n===== Channel processing complete =====
- Channels processed: ${channelsProcessed}/${channels.length}
- Significant changes detected: ${significantChangesDetected}
- Tweets posted: ${tweetsPosted}
- New videos detected: ${newVideosDetected}
- Errors encountered: ${errors}
=================================`);
    }
    
    /**
     * Check for new videos for a channel
     * @returns boolean - true if a new video was detected and processed
     */
    private async checkForNewVideos(channel: any): Promise<boolean> {
        try {
            console.log(`Checking for new videos for ${channel.name}...`);
            
            // Get latest videos
            const videos = await this.youtubeClient.getLatestVideos(channel.channelId, 1);
            
            if (videos.length === 0) {
                console.log(`No videos found for ${channel.name}`);
                return false;
            }
            
            const latestVideo = videos[0];
            const videoId = latestVideo.id;
            const videoTimestamp = latestVideo.publishedAt.getTime();
            
            console.log(`Latest video for ${channel.name}: "${latestVideo.title}" (ID: ${videoId})`);
            console.log(`Published at: ${new Date(videoTimestamp).toISOString()}`);
            console.log(`Current stored video ID: ${channel.metrics.lastVideoId || 'none'}`);
            console.log(`Current video timestamp: ${channel.metrics.lastVideoTimestamp ? new Date(channel.metrics.lastVideoTimestamp).toISOString() : 'none'}`);
            
            // Check if this is a new video and we haven't posted about it yet
            if (
                videoId !== channel.metrics.lastVideoId &&
                videoTimestamp > channel.metrics.lastVideoTimestamp &&
                !this.postedVideoIds.has(videoId)
            ) {
                console.log(`NEW VIDEO DETECTED for ${channel.name}: "${latestVideo.title}"`);
                
                // Update channel with new video info
                const updatedMetrics = {
                    ...channel.metrics,
                    lastVideoId: videoId,
                    lastVideoTimestamp: videoTimestamp
                };
                
                await storage.updateChannelMetrics(channel.channelId, updatedMetrics);
                console.log(`Updated last video ID in database for ${channel.name}`);
                
                // Post to Twitter
                console.log(`Announcing new video from ${channel.name} to Twitter`);
                const tweetText = TweetFormatter.formatNewVideoTweet(
                    { title: channel.name } as YoutubeChannel, 
                    latestVideo
                );
                
                const tweetSent = await this.sendTweet(
                    tweetText, 
                    `Announcing new video from ${channel.name}`
                );
                console.log(`New video announcement was ${tweetSent ? 'successfully posted' : 'not posted'} to Twitter`);
                
                // Mark as posted
                this.postedVideoIds.add(videoId);
                return true;
            } else {
                console.log(`No new video detected for ${channel.name} (or already posted)`);
                return false;
            }
        } catch (error) {
            console.error(`Error checking for new videos for ${channel.name}:`, error);
            return false;
        }
    }
    
    /**
     * Check for trending creators and update
     */
    private async getTrendingCreators(): Promise<void> {
        try {
            console.log("Checking for trending creators...");
            
            // Calculate trending creators using ViewAnalytics service
            const trendingChannels = await AnalyticService.getTrendingCreators(
                this.youtubeClient,
                5
            );
            
            if (trendingChannels.length === 0) {
                console.log("No trending creators found");
                return;
            }
            
            console.log(`Found ${trendingChannels.length} trending creators`);
            
            // Track these creators if not already tracked
            for (const channel of trendingChannels) {
                const isTracked = await storage.isChannelTracked(channel.id);
                
                if (!isTracked) {
                    console.log(`Adding trending creator to tracking: ${channel.title}`);
                    
                    await storage.trackChannel({
                        channelId: channel.id,
                        name: channel.title,
                        monitoringTier: 1, // Top tier for trending creators
                        metrics: {
                            subscribers: channel.statistics.subscriberCount,
                            views: channel.statistics.viewCount,
                            likes: 0,
                            lastVideoId: '',
                            lastVideoTimestamp: 0,
                            lastChecked: Date.now()
                        }
                    });
                    
                    // Announce new tracking on Twitter
                    if (this.twitterPlugin) {
                        const tweet = TweetFormatter.formatTrackingAnnouncementTweet(channel);
                        
                        try {
                            await this.twitterPlugin.postTweetFunction.executable({
                                tweet: tweet,
                                tweet_reasoning: `Started tracking trending creator ${channel.title}`
                            }, (msg: string) => console.log(`Twitter: ${msg}`));
                            
                            this.totalTweetsSent++;
                            this.updateState({
                                totalTweets: this.totalTweetsSent
                            });
                        } catch (tweetError) {
                            console.error("Error posting tracking announcement:", tweetError);
                        }
                    }
                } else {
                    console.log(`Creator already tracked: ${channel.title}`);
                    
                    // Engage with social media discussions about this trending creator
                    if (this.twitterPlugin && Math.random() < 0.7) { // 70% chance to engage
                        try {
                            console.log(`Engaging with discussions about ${channel.title}`);
                            
                            // Search for tweets mentioning this creator
                            const searchResult = await this.twitterPlugin.searchTweetsFunction.executable(
                                { query: channel.title },
                                (msg: string) => console.log(`Twitter search: ${msg}`)
                            );
                            
                            if (searchResult && searchResult.status === ExecutableGameFunctionStatus.Done) {
                                // Extract only the JSON part from the feedback
                                // The feedback format is: "Tweets found:\n[...]"
                                let feedbackString = searchResult.feedback;
                                let jsonStartIndex = feedbackString.indexOf('[');
                                
                                if (jsonStartIndex === -1) {
                                    console.log("No valid JSON found in search result");
                                    return;
                                }
                                
                                // Extract only the JSON part
                                let jsonString = feedbackString.substring(jsonStartIndex);
                                const tweets = JSON.parse(jsonString);
                                
                                // Get the full channel info from our database
                                const channelInfo = await storage.getChannel(channel.id);
                                
                                if (channelInfo && tweets.length > 0) {
                                    // Pick a random tweet to engage with (to avoid spamming)
                                    const randomIndex = Math.floor(Math.random() * Math.min(tweets.length, 3));
                                    const tweet = tweets[randomIndex];
                                    
                                    // Like the tweet
                                    await this.twitterPlugin.likeTweetFunction.executable(
                                        { tweet_id: tweet.tweetId },
                                        (msg: string) => console.log(`Twitter like: ${msg}`)
                                    );
                                    
                                    // Generate AI reply based on tweet content
                                    const aiReply = AIResponseGenerator.generateReply(
                                        tweet.content, 
                                        channel.title, 
                                        channelInfo.metrics
                                    );
                                    
                                    const replyReasoning = AIResponseGenerator.generateReplyReasoning(
                                        tweet.content,
                                        channel.title
                                    );
                                    
                                    // Reply to the tweet
                                    await this.twitterPlugin.replyTweetFunction.executable(
                                        {
                                            tweet_id: tweet.tweetId,
                                            reply: aiReply,
                                            reply_reasoning: replyReasoning
                                        },
                                        (msg: string) => console.log(`Twitter reply: ${msg}`)
                                    );
                                    
                                    // Check if the tweet has good engagement for quoting
                                    const impressions = tweet.impressions || (tweet.likes * 10 + tweet.retweets * 20); // Estimate impressions if not available
                                    const engagementRate = (tweet.likes + tweet.retweets) / impressions;
                                    
                                    // Only quote tweets with high engagement rate
                                    if (engagementRate > 0.02) { // 2% engagement rate threshold
                                        const quoteContent = AIResponseGenerator.generateQuote(
                                            tweet.content,
                                            channel.title,
                                            channelInfo.metrics
                                        );
                                        
                                        const quoteReasoning = AIResponseGenerator.generateQuoteReasoning(
                                            tweet.content,
                                            channel.title
                                        );
                                        
                                        // Quote the tweet
                                        await this.twitterPlugin.quoteTweetFunction.executable(
                                            {
                                                tweet_id: tweet.tweetId,
                                                quote: quoteContent
                                            },
                                            (msg: string) => console.log(`Twitter quote: ${msg}`)
                                        );
                                        
                                        console.log(`Quote reasoning: ${quoteReasoning}`);
                                    }
                                    
                                    this.totalTweetsSent++;
                                    this.updateState({
                                        totalTweets: this.totalTweetsSent
                                    });
                                }
                            }
                        } catch (engageError) {
                            console.error(`Error engaging with ${channel.title} tweets:`, engageError);
                        }
                    }
                }
            }
            
            // Update storage with latest trending list
            const trendingCreatorNames = trendingChannels.map(c => c.title);
            
            // Update state
            this.topCreators = trendingCreatorNames;
            this.lastTrendingUpdate = Date.now();
            
            this.updateState({
                topCreators: trendingCreatorNames,
                lastTrendingUpdate: new Date().toISOString()
            });
            
            console.log("Trending creators updated:", trendingCreatorNames);
            
            // Post a trending creators tweet
            if (this.twitterPlugin) {
                const trendingTweet = TweetFormatter.formatTrendingCreatorsTweet(trendingChannels);
                
                try {
                    await this.twitterPlugin.postTweetFunction.executable({
                        tweet: trendingTweet,
                        tweet_reasoning: "Sharing trending creators leaderboard"
                    }, (msg: string) => console.log(`Twitter: ${msg}`));
                    
                    this.totalTweetsSent++;
                    this.updateState({
                        totalTweets: this.totalTweetsSent
                    });
                } catch (tweetError) {
                    console.error("Error posting trending creators tweet:", tweetError);
                }
        }
        
    } catch (error) {
            console.error("Error checking trending creators:", error);
            throw error;
    }
}

    /**
     * Clean up expired creators
     */
    private async cleanupExpiredChannels(): Promise<void> {
    try {
            console.log("Checking for expired creators...");
            
            // Get monitoring duration (7 days by default)
        const monitoringDays = parseInt(process.env.CREATOR_MONITORING_DAYS || '7');
        const now = Date.now();
        
            // Get all tracked channels
            const channels = await storage.getAllTrackedChannels();
        
            for (const channel of channels) {
            // Calculate days since last trending
                const lastTrendingTime = new Date(channel.lastTrendingDate).getTime();
                const daysSinceTrending = (now - lastTrendingTime) / (24 * 60 * 60 * 1000);
                
                if (daysSinceTrending > monitoringDays) {
                    // Stop tracking after monitoring period
                    await storage.updateChannel(channel.channelId, {
                        isTracking: false
                    });
                    console.log(`Stopped tracking ${channel.name} after ${daysSinceTrending.toFixed(1)} days`);
                } else {
                    // Update tier based on days since trending
                    let newTier = 1; // Current trending (0-1 day)
                    
                    if (daysSinceTrending >= 1 && daysSinceTrending < 3) {
                        newTier = 2; // Recently trending (1-3 days)
                    } else if (daysSinceTrending >= 3) {
                        newTier = 3; // Previously trending (3+ days)
                    }
                    
                    if (newTier !== channel.monitoringTier) {
                        await storage.updateChannel(channel.channelId, {
                            monitoringTier: newTier
                        });
                        console.log(`Updated ${channel.name} to tier ${newTier} (${daysSinceTrending.toFixed(1)} days since trending)`);
                    }
                }
            }
        } catch (error) {
            console.error("Error cleaning up expired channels:", error);
        }
    }

    // Helper method to update state
    private updateState(state: Partial<PluginState>): void {
        if (this.onStateUpdate) {
            this.onStateUpdate(state);
        }
    }

    // Helper method to track tweet sending and update count
    private async sendTweet(tweet: string, reason: string): Promise<boolean> {
        if (!this.twitterPlugin) {
            console.log("No Twitter plugin available, tweet not sent");
            return false;
        }

        try {
            console.log(`Sending tweet: ${tweet.substring(0, 50)}... (${reason})`);
            
            // Direct access to twitterClient for more reliable posting
            // Use type assertion to access the private property
            const twitterClient = (this.twitterPlugin as any).twitterClient;
            
            if (!twitterClient || typeof twitterClient.post !== 'function') {
                console.error("Twitter client not available or missing post method");
                
                // Fallback to using the function if direct access fails
                const postTweetFunction = this.twitterPlugin.postTweetFunction;
                
                if (!postTweetFunction) {
                    throw new Error("Twitter plugin does not have a postTweetFunction");
                }
                
                // Execute the tweet using the function's executable method
                const result = await postTweetFunction.executable({
                    tweet: tweet,
                    tweet_reasoning: reason
                }, (msg: string) => console.log(`Twitter posting: ${msg}`));
                
                // Check if the tweet was successfully posted
                if (result.status === ExecutableGameFunctionStatus.Done) {
                    console.log("Tweet posted successfully via function!");
                    this.totalTweetsSent++;
                    this.updateState({ totalTweets: this.totalTweetsSent });
                    return true;
                } else {
                    console.error("Failed to post tweet via function. Status:", result.status);
                    return false;
                }
            }
            
            // Post directly using the client (more reliable method)
            console.log("Posting directly via Twitter client");
            await twitterClient.post(tweet);
            console.log("Tweet posted successfully via direct client access!");
            
            // Increment tweet counter
            this.totalTweetsSent++;
            
            // Update state with new tweet count
            this.updateState({
                totalTweets: this.totalTweetsSent
            });
            
            return true;
        } catch (error: any) {
            console.error(`Error posting tweet: ${error.message || error}`);
            return false;
        }
    }

    /**
     * Get the current running status
     */
    public get isRunning(): boolean {
        return this._isRunning;
    }

    private async processTrendingVideos(): Promise<void> {
        try {
            console.log("Fetching trending videos...");
            const videos = await this.youtubeClient.getTrendingVideos();
            
            if (!videos || videos.length === 0) {
                console.log("No trending videos found");
                return;
            }

            console.log(`Found ${videos.length} trending videos`);
            
            // Process each video
            for (const video of videos) {
                try {
                    // Get channel info
                    const channel = await this.youtubeClient.getChannel(video.channelId);
                    
                    if (!channel) {
                        console.log(`Could not fetch channel info for ${video.channelId}`);
                        continue;
                    }

                    // Check if we're already tracking this channel
                    const existingChannel = await storage.getChannel(channel.id);
                    
                    if (!existingChannel) {
                        // New trending channel found
                        console.log(`New trending channel found: ${channel.title}`);
                        
                        // Start tracking the channel
                        await storage.createChannel(
                            channel.id,
                            channel.title,
                            {
                                subscribers: channel.statistics.subscriberCount,
                                views: channel.statistics.viewCount,
                                likes: 0, // Will be updated in next metrics check
                                lastVideoId: '',
                                lastVideoTimestamp: 0,
                                lastChecked: Date.now()
                            }
                        );
                        
                        // Post announcement tweet
                        const tweet = TweetFormatter.formatTrackingAnnouncementTweet(channel);
                        await this.sendTweet(tweet, "New trending channel discovered");
                        
                        // Engage with tweets about this creator
                        await this.engageWithCreatorTweets(channel.title, channel.id);
                    }
                } catch (error) {
                    console.error(`Error processing video ${video.id}:`, error);
            }
        }
    } catch (error) {
            console.error("Error processing trending videos:", error);
        }
    }

    private async engageWithCreatorTweets(creatorName: string, channelId: string): Promise<void> {
        if (!this.twitterPlugin) {
            console.log("No Twitter plugin available, skipping tweet engagement");
            return;
        }

        try {
            console.log(`Searching for tweets about ${creatorName}`);
            
            // Search for tweets about the creator
            const searchResult = await this.twitterPlugin.searchTweetsFunction.executable(
                { query: creatorName },
                (msg: string) => console.log(`Searching tweets: ${msg}`)
            );

            if (searchResult && searchResult.status === ExecutableGameFunctionStatus.Done) {
                // Extract only the JSON part from the feedback
                // The feedback format is: "Tweets found:\n[...]"
                let feedbackString = searchResult.feedback;
                let jsonStartIndex = feedbackString.indexOf('[');
                
                if (jsonStartIndex === -1) {
                    console.log("No valid JSON found in search result");
                    return;
                }
                
                // Extract only the JSON part
                let jsonString = feedbackString.substring(jsonStartIndex);
                const tweets = JSON.parse(jsonString);
                
                // Get the full channel info from our database
                const channelInfo = await storage.getChannel(channelId);
                
                if (channelInfo && tweets.length > 0) {
                    // Process each tweet
                    for (const tweet of tweets) {
                        // Like the tweet
                        await this.twitterPlugin.likeTweetFunction.executable(
                            { tweet_id: tweet.tweetId },
                            (msg: string) => console.log(`Liking tweet: ${msg}`)
                        );

                        // Reply with growth insights if available
                        if (channelInfo) {
                            const reply = `📈 Growth Update: ${creatorName} has ${this.formatNumber(channelInfo.metrics.subscribers)} subscribers and ${this.formatNumber(channelInfo.metrics.views)} total views! #YouTubeGrowth`;
                            
                            await this.twitterPlugin.replyTweetFunction.executable(
                                { 
                                    tweet_id: tweet.tweetId,
                                    reply: reply,
                                    reply_reasoning: "Sharing growth metrics with the community"
                                },
                                (msg: string) => console.log(`Replying to tweet: ${msg}`)
                            );
                        }
                    }
                }
            }
    } catch (error) {
            console.error("Error engaging with tweets:", error);
        }
    }

    private formatNumber(num: number): string {
        if (num >= 1000000) {
            return `${(num / 1000000).toFixed(1)}M`;
        }
        if (num >= 1000) {
            return `${(num / 1000).toFixed(1)}K`;
        }
        return num.toString();
}
}