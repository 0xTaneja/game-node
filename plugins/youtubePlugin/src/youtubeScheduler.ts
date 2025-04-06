import { YoutubeChannel, YoutubeVideo, youtubeClient } from './youtubeClient';
import TwitterPlugin from '../../twitterPlugin/src/twitterPlugin';
import * as storage from '../db/storage';
import { TweetFormatter } from './tweetFormatter';
import { AnalyticService } from './analyticService';
import { PluginState } from './youtubePlugin';

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
    private isRunning: boolean = false;
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
        
        if (this.isRunning) {
            console.log("Scheduler is already running!");
            return;
        }
        
        this.isRunning = true;
        
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
            
            // Schedule regular metrics check (every 30 minutes)
            this.metricsCheckInterval = setInterval(() => {
                this.checkAllChannelMetrics().catch((err: Error) => {
                    console.error("Error in scheduled metrics check:", err);
                });
            }, 30 * 60 * 1000); // 30 minutes
            
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
        
        if (!this.isRunning) {
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
        
        this.isRunning = false;
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
        for (const channel of channels) {
            try {
                console.log(`Processing channel: ${channel.name} (${channel.channelId})`);
                
                // Get fresh channel data
                const channelData = await this.youtubeClient.getChannel(channel.channelId);
                
                if (!channelData) {
                    console.log(`Could not fetch data for channel ${channel.name}`);
                    continue;
                }
                
                // Get total likes
                const totalLikes = await this.youtubeClient.getTotalChannelLikes(channel.channelId);
                
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
                
                // Check for significant changes using adaptive thresholds
                const subsChange = Math.abs((newMetrics.subscribers - oldMetrics.subscribers) / oldMetrics.subscribers);
                const viewsChange = Math.abs((newMetrics.views - oldMetrics.views) / oldMetrics.views);
                const likesChange = Math.abs((newMetrics.likes - oldMetrics.likes) / (oldMetrics.likes || 1));
                
                const subsThreshold = storage.getAdaptiveThreshold('SUBS_CHANGE', newMetrics.subscribers);
                const viewsThreshold = storage.getAdaptiveThreshold('VIEWS_CHANGE', newMetrics.views);
                const likesThreshold = storage.getAdaptiveThreshold('LIKES_CHANGE', newMetrics.likes);
                
                const hasSignificantChange = 
                    subsChange > subsThreshold ||
                    viewsChange > viewsThreshold ||
                    likesChange > likesThreshold;
                
                // Update metrics in database
                await storage.updateChannelMetrics(channel.channelId, newMetrics);
                
                if (hasSignificantChange) {
                    console.log(`Significant changes detected for ${channel.name}`);
                    
                    // Post update to Twitter
                    const tweetText = TweetFormatter.formatMetricsUpdateTweet(
                        channelData,
                        oldMetrics,
                        newMetrics
                    );
                    
                    await this.sendTweet(tweetText, "Posting significant metrics update");
                }
                
                // Check for new videos
                await this.checkForNewVideos(channel);
                
            } catch (error) {
                console.error(`Error processing channel ${channel.name}:`, error);
            }
        }
    }
    
    /**
     * Check for new videos for a channel
     */
    private async checkForNewVideos(channel: any): Promise<void> {
        try {
            // Get latest videos
            const videos = await this.youtubeClient.getLatestVideos(channel.channelId, 1);
            
            if (videos.length === 0) return;
            
            const latestVideo = videos[0];
            const videoId = latestVideo.id;
            const videoTimestamp = latestVideo.publishedAt.getTime();
            
            // Check if this is a new video and we haven't posted about it yet
            if (
                videoId !== channel.metrics.lastVideoId &&
                videoTimestamp > channel.metrics.lastVideoTimestamp &&
                !this.postedVideoIds.has(videoId)
            ) {
                console.log(`New video detected for ${channel.name}: ${latestVideo.title}`);
                
                // Update channel with new video info
                const updatedMetrics = {
                    ...channel.metrics,
                    lastVideoId: videoId,
                    lastVideoTimestamp: videoTimestamp
                };
                
                await storage.updateChannelMetrics(channel.channelId, updatedMetrics);
                
                // Post to Twitter
                const tweetText = TweetFormatter.formatNewVideoTweet(
                    { title: channel.name } as YoutubeChannel, 
                    latestVideo
                );
                
                await this.sendTweet(tweetText, "Announcing new video");
                
                // Mark as posted
                this.postedVideoIds.add(videoId);
            }
        } catch (error) {
            console.error(`Error checking for new videos for ${channel.name}:`, error);
        }
    }
    
    /**
     * Add method to fetch trending creators
     */
    private async getTrendingCreators(): Promise<void> {
        try {
            console.log("Fetching trending YouTube creators...");
            
            // First get trending videos
            const trendingVideos = await this.youtubeClient.getTrendingVideos("US", 50);
            
            if (!trendingVideos || trendingVideos.length === 0) {
                console.log("No trending videos found");
                return;
            }
            
            console.log(`Found ${trendingVideos.length} trending videos`);
            
            // Extract unique channel IDs from trending videos
            const channelIds = [...new Set(trendingVideos.map(video => video.channelId))];
            console.log(`Extracted ${channelIds.length} unique channels from trending videos`);
            
            // Get channel details
            const channels = await Promise.all(
                channelIds.map(async id => {
                    try {
                        return await this.youtubeClient.getChannel(id);
                    } catch (error) {
                        console.error(`Error fetching channel ${id}:`, error);
                        return null;
                    }
                })
            );
            
            const validChannels = channels.filter(channel => channel !== null) as YoutubeChannel[];
            console.log(`Successfully fetched ${validChannels.length} channel details`);
            
            // Calculate engagement scores for channels
            const channelsWithScore = validChannels.map(channel => {
                const views = Number(channel.statistics.viewCount);
                const subs = Number(channel.statistics.subscriberCount);
                const videos = Number(channel.statistics.videoCount);
                
                // Engagement score calculation - similar to YoutubeMonitor.ts
                const viewsPerVideo = videos > 0 ? views / videos : 0;
                const subsToViewsRatio = views > 0 ? subs / views : 0;
                const engagementScore = viewsPerVideo * Math.log10(subs + 1) * (1 + subsToViewsRatio);
                
                return {
                    ...channel,
                    engagementScore
                };
            });
            
            // Sort by engagement score and get top 5
            const topCreators = channelsWithScore
                .sort((a, b) => b.engagementScore - a.engagementScore)
                .slice(0, 5);
                
            console.log(`Selected top ${topCreators.length} trending creators`);
            
            // Update state with top creator names
            this.topCreators = topCreators.map(c => c.title);
            this.updateState({
                topCreators: this.topCreators,
                lastTrendingUpdate: new Date().toISOString()
            });
            
            // Start tracking these creators
            for (const creator of topCreators) {
                try {
                    // Check if already tracking
                    const existingChannel = await storage.getChannel(creator.id);
                    
                    if (existingChannel) {
                        console.log(`Already tracking ${creator.title}, updating metrics...`);
                        // Update monitoring tier to tier 1 (current trending)
                        await storage.updateChannel(creator.id, {
                            lastTrendingDate: new Date(),
                            monitoringTier: 1
                        });
                    } else {
                        console.log(`Adding new trending channel to tracking: ${creator.title}`);
                        
                        // Get additional metrics
                        const totalLikes = await this.youtubeClient.getTotalChannelLikes(creator.id);
                        
                        // Create new channel in database
                        const metrics = {
                            subscribers: creator.statistics.subscriberCount,
                            views: creator.statistics.viewCount,
                            likes: totalLikes,
                            lastVideoId: '',
                            lastVideoTimestamp: 0,
                            lastChecked: Date.now()
                        };
                        
                        await storage.createChannel(creator.id, creator.title, metrics);
                        
                        // Announce new channel on Twitter
                        const tweetText = TweetFormatter.formatTrackingAnnouncementTweet(creator);
                        await this.sendTweet(tweetText, "Announcing new trending channel discovery");
                    }
                } catch (error) {
                    console.error(`Error tracking trending creator ${creator.title}:`, error);
                }
            }
            
            // Post trending creators tweet
            if (topCreators.length > 0) {
                try {
                    const tweetText = TweetFormatter.formatTrendingCreatorsTweet(topCreators);
                    await this.sendTweet(tweetText, "Posting trending creators update");
                } catch (error) {
                    console.error("Error posting trending creators tweet:", error);
                }
            }
            
            // Update last trending update timestamp
            this.lastTrendingUpdate = Date.now();
            
        } catch (error) {
            console.error("Error fetching trending creators:", error);
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
            
            await this.twitterPlugin.postTweetFunction.executable({
                tweet: tweet,
                tweet_reasoning: reason
            }, (msg: string) => console.log(msg));
            
            // Increment tweet counter
            this.totalTweetsSent++;
            
            // Update state with new tweet count
            this.updateState({
                totalTweets: this.totalTweetsSent
            });
            
            return true;
        } catch (error) {
            console.error("Error sending tweet:", error);
            return false;
        }
    }
}