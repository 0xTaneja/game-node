import axios from "axios";
import dotenv from "dotenv";

dotenv.config();


export interface YoutubeChannel {
    id:string;
    title:string;
    description:string;
    thumbnailUrl:string;
    statistics:{
        viewCount:number;
        subscriberCount:number;
        videoCount:number;

    };
}

export interface YoutubeVideo{
    id:string;
    channelId:string;
    channelTitle:string;
    title:string;
    publishedAt:Date;
    thumbnailUrl:string;
    statistics:{
        viewCount:number;
        likeCount:number;
        commentCount:number;
    }
}

export class youtubeClient{
    private baseUrl = 'https://www.googleapis.com/youtube/v3';
    private apiKeys: string[];
    private currentKeyIndex = 0 ;

    constructor(apiKeys:string[]){
        if(!apiKeys ||apiKeys.length==0){
            throw new Error('At least one YouTube API key is required');
        }
        this.apiKeys = apiKeys.filter(key => !!key);

        if (this.apiKeys.length === 0) {
            throw new Error('No valid YouTube API keys provided');
        }
    }
    private getCurrentApiKey():string{
        return this.apiKeys[this.currentKeyIndex];
    }
    private rotateApiKey():string{
        this.currentKeyIndex = (this.currentKeyIndex + 1 )%this.apiKeys.length;
        console.log(`Rotating to next YouTube API key: ${this.getCurrentApiKey().substring(0, 5)}...`);
        return this.getCurrentApiKey();
    }

    async getTrendingVideos(regionCode:string = 'US',maxResults:number = 10): Promise<YoutubeVideo[]>{
        let attempts = 0;
        const maxAttempts = this.apiKeys.length;

        while(attempts<maxAttempts){
            try{
               const response = await axios.get(`${this.baseUrl}/videos`,{
                params:{
                    part:'snippet,statistics',
                    chart:'mostPopular',
                    regionCode,
                    maxResults,
                    key:this.getCurrentApiKey()
                }
               })
              
               const videos = response.data.items || [];
               return videos.map((video: any) => ({
                id: video.id || '',
                channelId: video.snippet?.channelId || '',
                channelTitle: video.snippet?.channelTitle || '',
                title: video.snippet?.title || '',
                publishedAt: new Date(video.snippet?.publishedAt || ''),
                thumbnailUrl: video.snippet?.thumbnails?.default?.url || '',
                statistics: {
                  viewCount: Number(video.statistics?.viewCount || 0),
                  likeCount: Number(video.statistics?.likeCount || 0),
                  commentCount: Number(video.statistics?.commentCount || 0)
                }
              }));
            }
            catch(error){
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                console.error('Error fetching trending videos:', errorMessage);
        
                // Try rotating API key on error
                this.rotateApiKey();
                attempts++;
                
                // If we've tried all keys, return empty array
                if (attempts >= maxAttempts) {
                  console.error(`All API keys failed when fetching trending videos after ${attempts} attempts.`);
                  return [];
                }
            }
        }
        return [];
    }

    async getChannel(channelId: string): Promise<YoutubeChannel | null> {
        let attempts = 0;
        const maxAttempts = this.apiKeys.length; // Try each key at most once
        
        while (attempts < maxAttempts) {
          try {
            const response = await axios.get(`${this.baseUrl}/channels`, {
              params: {
                part: 'snippet,statistics',
                id: channelId,
                key: this.getCurrentApiKey()
              }
            });
    
            const channel = response.data.items?.[0];
            
            if (!channel) return null;
            
            return {
              id: channel.id || '',
              title: channel.snippet?.title || '',
              description: channel.snippet?.description || '',
              thumbnailUrl: channel.snippet?.thumbnails?.default?.url || '',
              statistics: {
                viewCount: Number(channel.statistics?.viewCount || 0),
                subscriberCount: Number(channel.statistics?.subscriberCount || 0),
                videoCount: Number(channel.statistics?.videoCount || 0)
              }
            };
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error(`Error fetching channel ${channelId}:`, errorMessage);
            
            // Try rotating API key on error
            this.rotateApiKey();
            attempts++;
            
            // If we've tried all keys, return null
            if (attempts >= maxAttempts) {
              console.error(`All API keys failed when fetching channel ${channelId} after ${attempts} attempts.`);
              return null;
            }
          }
        }
        
        return null;
      }
    
      /**
       * Get multiple channels by ID
       */
      async getChannels(channelIds: string[]): Promise<YoutubeChannel[]> {
        if (channelIds.length === 0) return [];
        
        let attempts = 0;
        const maxAttempts = this.apiKeys.length; // Try each key at most once
        
        while (attempts < maxAttempts) {
          try {
            const response = await axios.get(`${this.baseUrl}/channels`, {
              params: {
                part: 'snippet,statistics',
                id: channelIds.join(','),
                key: this.getCurrentApiKey()
              }
            });
    
            const channels = response.data.items || [];
            
            return channels.map((channel: any) => ({
              id: channel.id || '',
              title: channel.snippet?.title || '',
              description: channel.snippet?.description || '',
              thumbnailUrl: channel.snippet?.thumbnails?.default?.url || '',
              statistics: {
                viewCount: Number(channel.statistics?.viewCount || 0),
                subscriberCount: Number(channel.statistics?.subscriberCount || 0),
                videoCount: Number(channel.statistics?.videoCount || 0)
              }
            }));
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error(`Error fetching channels:`, errorMessage);
            
            // Try rotating API key on error
            this.rotateApiKey();
            attempts++;
            
            // If we've tried all keys, return empty array
            if (attempts >= maxAttempts) {
              console.error(`All API keys failed when fetching channels after ${attempts} attempts.`);
              return [];
            }
          }
        }
        
        return [];
      }
    
      /**
       * Get latest videos from a channel
       */
      async getLatestVideos(channelId: string, maxResults: number = 5): Promise<YoutubeVideo[]> {
        let attempts = 0;
        const maxAttempts = this.apiKeys.length; // Try each key at most once
        
        while (attempts < maxAttempts) {
          try {
            // First, search for videos
            const searchResponse = await axios.get(`${this.baseUrl}/search`, {
              params: {
                part: 'snippet',
                channelId,
                order: 'date',
                maxResults,
                type: 'video',
                key: this.getCurrentApiKey()
              }
            });
    
            const videoIds = searchResponse.data.items?.map((item: any) => item.id?.videoId || '') || [];
            
            if (videoIds.length === 0) return [];
            
            // Then get detailed video information
            const videosResponse = await axios.get(`${this.baseUrl}/videos`, {
              params: {
                part: 'snippet,statistics',
                id: videoIds.join(','),
                key: this.getCurrentApiKey()
              }
            });
    
            const videos = videosResponse.data.items || [];
            
            return videos.map((video: any) => ({
              id: video.id || '',
              channelId: video.snippet?.channelId || '',
              channelTitle: video.snippet?.channelTitle || '',
              title: video.snippet?.title || '',
              publishedAt: new Date(video.snippet?.publishedAt || ''),
              thumbnailUrl: video.snippet?.thumbnails?.default?.url || '',
              statistics: {
                viewCount: Number(video.statistics?.viewCount || 0),
                likeCount: Number(video.statistics?.likeCount || 0),
                commentCount: Number(video.statistics?.commentCount || 0)
              }
            }));
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error(`Error fetching latest videos for channel ${channelId}:`, errorMessage);
            
            // Try rotating API key on error
            this.rotateApiKey();
            attempts++;
            
            // If we've tried all keys, return empty array
            if (attempts >= maxAttempts) {
              console.error(`All API keys failed when fetching latest videos after ${attempts} attempts.`);
              return [];
            }
          }
        }
        
        return [];
      }
    
      /**
       * Get total likes for a channel
       */
      async getTotalChannelLikes(channelId: string): Promise<number> {
        let attempts = 0;
        const maxAttempts = this.apiKeys.length; // Try each key at most once
        
        while (attempts < maxAttempts) {
          try {
            // Get top videos by view count
            const searchResponse = await axios.get(`${this.baseUrl}/search`, {
              params: {
                part: 'snippet',
                channelId,
                order: 'viewCount',
                maxResults: 10,
                type: 'video',
                key: this.getCurrentApiKey()
              }
            });
    
            const videoIds = searchResponse.data.items?.map((item: any) => item.id?.videoId || '') || [];
            
            if (videoIds.length === 0) return 0;
            
            // Get statistics for these videos
            const videosResponse = await axios.get(`${this.baseUrl}/videos`, {
              params: {
                part: 'statistics',
                id: videoIds.join(','),
                key: this.getCurrentApiKey()
              }
            });
    
            const videos = videosResponse.data.items || [];
            
            // Sum up likes
            return videos.reduce((total: number, video: any) => {
              return total + Number(video.statistics?.likeCount || 0);
            }, 0);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error(`Error fetching total likes for channel ${channelId}:`, errorMessage);
            
            // Try rotating API key on error
            this.rotateApiKey();
            attempts++;
            
            // If we've tried all keys, return 0
            if (attempts >= maxAttempts) {
              console.error(`All API keys failed when fetching total likes after ${attempts} attempts.`);
              return 0;
            }
          }
        }
        
        return 0;
      }
      
      /**
       * Search for YouTube channels
       */
      async searchChannels(query: string, maxResults: number = 5): Promise<YoutubeChannel[]> {
        let attempts = 0;
        const maxAttempts = this.apiKeys.length; // Try each key at most once
        
        while (attempts < maxAttempts) {
          try {
            // Search for channels
            const searchResponse = await axios.get(`${this.baseUrl}/search`, {
              params: {
                part: 'snippet',
                q: query,
                maxResults,
                type: 'channel',
                key: this.getCurrentApiKey()
              }
            });
    
            const channelIds = searchResponse.data.items?.map((item: any) => item.id?.channelId || '') || [];
            
            if (channelIds.length === 0) return [];
            
            // Get detailed channel information
            return this.getChannels(channelIds);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error(`Error searching for channels with query "${query}":`, errorMessage);
            
            // Try rotating API key on error
            this.rotateApiKey();
            attempts++;
            
            // If we've tried all keys, return empty array
            if (attempts >= maxAttempts) {
              console.error(`All API keys failed when searching channels after ${attempts} attempts.`);
              return [];
            }
          }
        }
        
        return [];
      }
} 