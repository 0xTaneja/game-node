import { YoutubeChannel, YoutubeVideo } from './youtubeClient';
import { IChannel, ChannelMetrics } from '../db/storage';

/**
 * Utility class for formatting tweets related to YouTube creator metrics
 * and events. Includes rich text formatting, emoji usage, and number formatting.
 */
export class TweetFormatter {
  /**
   * Format a number for display in tweets
   * @param num Number to format
   * @param useSeparators Whether to use thousand separators
   * @returns Formatted number string
   */
  static formatNumber(num: number, useSeparators = true): string {
    if (num >= 1000000) {
      return `${(num / 1000000).toFixed(1)}M`;
    }
    if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}K`;
    }
    return useSeparators ? num.toLocaleString() : num.toString();
  }

  /**
   * Format a percentage change with appropriate indicators
   * @param oldValue Previous value
   * @param newValue Current value
   * @returns Formatted percentage string with direction indicator
   */
  static formatPercentageChange(oldValue: number, newValue: number): string {
    if (oldValue === 0) return '';
    
    const percentChange = ((newValue - oldValue) / oldValue) * 100;
    const absChange = Math.abs(percentChange).toFixed(2);
    
    if (percentChange > 0) {
      return `⬆️ +${absChange}%`;
    } else if (percentChange < 0) {
      return `⬇️ -${absChange}%`;
    }
    return '';
  }

  /**
   * Format a new video announcement tweet
   * @param channel YouTube channel
   * @param video Latest video
   * @returns Formatted tweet text
   */
  static formatNewVideoTweet(channel: YoutubeChannel, video: YoutubeVideo): string {
    // Select a random emoji for variety
    const emojis = ['🎥', '📹', '🎬', '📺', '🔴'];
    const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
    
    // Create attention-grabbing header with creator name
    const header = `${randomEmoji} NEW VIDEO ALERT ${randomEmoji}\n`;
    
    // Format main content with video details
    const content = `${channel.title} just uploaded:\n\n"${video.title}"\n\n`;
    
    // Add video link and call to action
    const footer = `🔗 Watch now: https://youtu.be/${video.id}\n\n` +
      `🔔 Like, Comment & Subscribe! #YouTube #${channel.title.replace(/\s+/g, '')} #NewContent`;
    
    return header + content + footer;
  }

  /**
   * Format a metrics update tweet
   * @param channelInfo YouTube channel info
   * @param oldMetrics Previous metrics
   * @param currentMetrics Current metrics
   * @returns Formatted tweet text
   */
  static formatMetricsUpdateTweet(
    channelInfo: YoutubeChannel,
    oldMetrics: ChannelMetrics,
    currentMetrics: ChannelMetrics
  ): string {
    const timestamp = new Date().toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
    
    // Create descriptive header with timestamp
    const header = `📊 CREATOR METRICS UPDATE • ${timestamp}\n\n`;
    
    // Add creator name with decoration
    const creatorLine = `✨ ${channelInfo.title} ✨\n\n`;
    
    // Format each metric with value and change percentage
    const subscribersChange = this.formatPercentageChange(oldMetrics.subscribers, currentMetrics.subscribers);
    const viewsChange = this.formatPercentageChange(oldMetrics.views, currentMetrics.views);
    const likesChange = this.formatPercentageChange(oldMetrics.likes, currentMetrics.likes);
    
    const subscribersLine = `👥 Subscribers: ${this.formatNumber(currentMetrics.subscribers, true)} ${subscribersChange}\n`;
    const viewsLine = `👁️ Total Views: ${this.formatNumber(currentMetrics.views, true)} ${viewsChange}\n`;
    const likesLine = `❤️ Total Likes: ${this.formatNumber(currentMetrics.likes, true)} ${likesChange}\n\n`;
    
    // Add hashtags relevant to growth
    let hashtags = '#YouTubeGrowth #CreatorAnalytics';
    
    // Add conditional hashtags based on growth
    if (currentMetrics.subscribers > oldMetrics.subscribers) {
      hashtags += ' #GrowingCreator';
    }
    if (currentMetrics.views - oldMetrics.views > 10000) {
      hashtags += ' #ViralContent';
    }
    
    return header + creatorLine + subscribersLine + viewsLine + likesLine + hashtags;
  }

  /**
   * Format a trending creators leaderboard tweet
   * @param topCreators Array of trending channels
   * @returns Formatted tweet text
   */
  static formatTrendingCreatorsTweet(topCreators: YoutubeChannel[]): string {
    const date = new Date().toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    });
    
    // Create attention-grabbing header with date
    const headerText = `🔥 TRENDING CREATORS • ${date} 🔥\n\n`;
    
    // Format each creator entry with rich details
    const creatorEntries = topCreators.map((creator, i) => {
      const rank = this.formatRank(i + 1);
      const subs = this.formatNumber(creator.statistics.subscriberCount);
      const views = this.formatNumber(creator.statistics.viewCount);
      const videos = creator.statistics.videoCount;
      
      return `${rank} ${creator.title}\n` +
             `   👥 ${subs} subscribers\n` +
             `   👁️ ${views} views\n` +
             `   🎬 ${videos} videos\n` +
             `   🔗 youtube.com/channel/${creator.id}`;
    });
    
    // Add engaging footer with call to action
    const footerText = `\n\n📈 Follow these creators for amazing content! 🚀\n#YouTube #TrendingCreators #ContentCreation`;
    
    return headerText + creatorEntries.join('\n\n') + footerText;
  }

  /**
   * Format a daily leaderboard tweet
   * @param topGrowers Array of creators with highest growth
   * @returns Formatted tweet text
   */
  static formatDailyLeaderboardTweet(topGrowers: Array<{
    name: string;
    subscribers: number;
    growth: number;
    channelId: string;
  }>): string {
    const date = new Date().toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    });
    
    // Create trophy-themed header
    const headerText = `🏆 DAILY GROWTH CHAMPIONS • ${date} 🏆\n\n`;
    
    // Format each creator entry with growth stats
    const creatorEntries = topGrowers.map((creator, i) => {
      const rank = this.formatRank(i + 1);
      const subs = this.formatNumber(creator.subscribers);
      const growthEmoji = creator.growth > 0 ? '📈' : '📉';
      const growthText = Math.abs(creator.growth).toFixed(2);
      
      return `${rank} ${creator.name}\n` +
             `   👥 ${subs} Subscribers\n` +
             `   ${growthEmoji} ${growthText}% change in 24hrs`;
    });
    
    // Add inspiring footer
    const footerText = `\n\n🚀 Keep growing, creators! Who will top tomorrow's list? 🤔\n#YouTubeGrowth #CreatorEconomy #ContentCreators`;
    
    return headerText + creatorEntries.join('\n\n') + footerText;
  }

  /**
   * Format a tracking announcement tweet
   * @param channelInfo YouTube channel being tracked
   * @returns Formatted tweet text
   */
  static formatTrackingAnnouncementTweet(channelInfo: YoutubeChannel): string {
    return `📡 NOW TRACKING: ${channelInfo.title}! 📡\n\n` +
           `👥 ${this.formatNumber(channelInfo.statistics.subscriberCount)} subscribers\n` +
           `👁️ ${this.formatNumber(channelInfo.statistics.viewCount)} views\n` +
           `🎬 ${channelInfo.statistics.videoCount} videos\n\n` +
           `We'll monitor growth and notify about significant changes! 📊\n\n` +
           `#YouTubeCreator #ContentCreation`;
  }

  /**
   * Format rank with appropriate emoji
   * @param rank Numeric rank
   * @returns Formatted rank string
   */
  private static formatRank(rank: number): string {
    const medals = ['🥇', '🥈', '🥉'];
    return rank <= 3 ? `${medals[rank - 1]} #${rank}` : `#${rank}`;
  }
} 