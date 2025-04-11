import { YoutubeChannel, YoutubeVideo } from './youtubeClient';
import { ChannelMetrics } from '../db/storage';

/**
 * Utility class for generating AI-powered dynamic responses for tweets and replies
 * Adds personality and context-awareness to social media interactions
 */
export class AIResponseGenerator {
  /**
   * Generate a dynamic, contextually relevant reply to a tweet about a creator
   * @param tweetContent The content of the original tweet
   * @param creatorName The YouTube creator's name
   * @param metrics The creator's current metrics
   * @returns Personalized AI-generated reply
   */
  static generateReply(tweetContent: string, creatorName: string, metrics: ChannelMetrics): string {
    // Extract sentiment and main topics from the tweet
    const sentiment = this.analyzeSentiment(tweetContent);
    const topics = this.extractTopics(tweetContent);
    
    // Generate dynamic response based on sentiment and content
    let reply = '';
    
    // Format subscribers and views for readability
    const formattedSubs = this.formatMetric(metrics.subscribers);
    const formattedViews = this.formatMetric(metrics.views);
    
    // Positive sentiment responses
    if (sentiment === 'positive') {
      if (topics.includes('growth')) {
        reply = `Thanks for noticing ${creatorName}'s amazing growth! 🚀 They've reached ${formattedSubs} subscribers and ${formattedViews} views. Their dedication to great content is really paying off! #CreatorSuccess`;
      } else if (topics.includes('content')) {
        reply = `Glad you're enjoying ${creatorName}'s content! They've built an impressive channel with ${formattedSubs} subscribers who feel the same way. Their videos have ${formattedViews} total views! #ContentCreator`;
      } else {
        reply = `We love ${creatorName} too! 💯 They've been crushing it with ${formattedSubs} subscribers and ${formattedViews} views. Excited to see what they create next! #YouTubeCreator`;
      }
    } 
    // Neutral sentiment responses
    else if (sentiment === 'neutral') {
      if (topics.includes('question')) {
        reply = `Great question about ${creatorName}! Currently they have ${formattedSubs} subscribers and ${formattedViews} total views. Hope that helps! #CreatorStats`;
      } else if (topics.includes('comparison')) {
        reply = `Interesting comparison! ${creatorName} currently has ${formattedSubs} subscribers and ${formattedViews} views. Their growth trajectory has been impressive! #CreatorInsights`;
      } else {
        reply = `Thanks for mentioning ${creatorName}! Just so you know, they currently have ${formattedSubs} subscribers and their content has garnered ${formattedViews} views. #YouTubeStats`;
      }
    }
    // Negative sentiment responses (handled tactfully)
    else {
      reply = `We appreciate your perspective on ${creatorName}. Their channel has grown to ${formattedSubs} subscribers with ${formattedViews} views, showing they resonate with many viewers. #CreatorJourney`;
    }
    
    // Ensure the reply doesn't exceed Twitter's character limit
    if (reply.length > 280) {
      reply = reply.substring(0, 277) + '...';
    }
    
    return reply;
  }
  
  /**
   * Generate reasoning for the reply (useful for AI decision-making)
   * @param tweetContent Original tweet content
   * @param creatorName Creator's name
   * @returns Reasoning string explaining the reply approach
   */
  static generateReplyReasoning(tweetContent: string, creatorName: string): string {
    const sentiment = this.analyzeSentiment(tweetContent);
    const topics = this.extractTopics(tweetContent);
    
    let reasoning = `Engaging with tweet about ${creatorName} - `;
    
    if (sentiment === 'positive') {
      reasoning += 'responding to positive sentiment with enthusiastic metrics';
    } else if (sentiment === 'neutral') {
      reasoning += 'providing factual information to neutral mention';
    } else {
      reasoning += 'tactfully responding to criticism with objective metrics';
    }
    
    if (topics.length > 0) {
      reasoning += ` while addressing ${topics.join(', ')} mentioned in the tweet`;
    }
    
    return reasoning;
  }
  
  /**
   * Generate reasoning for a quote tweet
   * @param tweetContent Original tweet content
   * @param creatorName Creator being discussed
   * @returns Reasoning for the quote tweet
   */
  static generateQuoteReasoning(tweetContent: string, creatorName: string): string {
    return `Amplifying discussion about ${creatorName} with additional context and metrics`;
  }
  
  /**
   * Generate content for a quote tweet
   * @param tweetContent Original tweet content
   * @param creatorName Creator's name
   * @param metrics Creator's metrics
   * @returns Quote tweet content
   */
  static generateQuote(tweetContent: string, creatorName: string, metrics: ChannelMetrics): string {
    const formattedSubs = this.formatMetric(metrics.subscribers);
    const formattedViews = this.formatMetric(metrics.views);
    
    // Generate different quotes based on tweet content
    const contentFocus = tweetContent.toLowerCase().includes('content') || 
                         tweetContent.toLowerCase().includes('video');
    
    if (contentFocus) {
      return `Great conversation about ${creatorName}'s content! They've built an audience of ${formattedSubs} subscribers through consistent quality. Their videos have accumulated ${formattedViews} views! #ContentCreation`;
    } else {
      return `Adding some context to this discussion about ${creatorName} - their channel has grown to ${formattedSubs} subscribers and ${formattedViews} views, showing their impact in the creator space. #CreatorEconomy`;
    }
  }
  
  /**
   * Simple sentiment analysis of tweet content
   * @param content Tweet content
   * @returns Sentiment classification
   */
  private static analyzeSentiment(content: string): 'positive' | 'neutral' | 'negative' {
    const text = content.toLowerCase();
    
    // Simple keyword-based sentiment analysis
    const positiveWords = ['love', 'great', 'amazing', 'awesome', 'good', 'best', 'fan', 'enjoy', 'like', '❤️', '👍', '🔥'];
    const negativeWords = ['hate', 'bad', 'terrible', 'worst', 'dislike', 'disappointed', 'awful', 'sucks', 'boring', '👎'];
    
    let positiveScore = 0;
    let negativeScore = 0;
    
    // Calculate scores
    positiveWords.forEach(word => {
      if (text.includes(word)) positiveScore++;
    });
    
    negativeWords.forEach(word => {
      if (text.includes(word)) negativeScore++;
    });
    
    // Determine sentiment
    if (positiveScore > negativeScore) return 'positive';
    if (negativeScore > positiveScore) return 'negative';
    return 'neutral';
  }
  
  /**
   * Extract main topics from tweet content
   * @param content Tweet content
   * @returns Array of identified topics
   */
  static extractTopics(content: string): string[] {
    const text = content.toLowerCase();
    const topics: string[] = [];
    
    // Topic identification logic
    if (text.includes('subscriber') || text.includes('growth') || text.includes('growing')) {
      topics.push('growth');
    }
    
    if (text.includes('video') || text.includes('content') || text.includes('watch')) {
      topics.push('content');
    }
    
    if (text.includes('?') || text.includes('how') || text.includes('what') || text.includes('why')) {
      topics.push('question');
    }
    
    if (text.includes('vs') || text.includes('better') || text.includes('compared') || text.includes('than')) {
      topics.push('comparison');
    }
    
    return topics;
  }
  
  /**
   * Format metrics for readability
   * @param value Numeric value
   * @returns Formatted string
   */
  private static formatMetric(value: number): string {
    if (value >= 1000000) {
      return `${(value / 1000000).toFixed(1)}M`;
    }
    if (value >= 1000) {
      return `${(value / 1000).toFixed(1)}K`;
    }
    return value.toString();
  }
} 