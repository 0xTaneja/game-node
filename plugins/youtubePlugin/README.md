# YouTube Monitoring Plugin for Yuna

This plugin tracks trending YouTube creators, monitors their metrics (subscribers, views, likes), and posts updates to Twitter when significant changes are detected.

## Features

- **Automated Trending Creator Discovery**: Dynamically discovers trending creators from the YouTube API
- **Multi-Tier Monitoring**: Tracks channels in different tiers (current trending, recently trending, previously trending)
- **Adaptive Thresholds**: Uses smart thresholds based on channel size to determine significant changes
- **Automatic Twitter Updates**: Posts updates about new videos, significant metric changes, and trending creators
- **API Key Rotation**: Supports multiple YouTube API keys with automatic rotation to handle rate limits
- **State Management**: Maintains state about tracking and integrates with agent state management

## Setup

### Requirements

- Node.js 16+
- MongoDB database
- YouTube API key(s)
- Twitter API access token

### Environment Variables

Create or update the `.env` file in the root folder (`/game-node/.env`) with:

```
# API Keys
API_KEY=your_api_key_for_agent
YOUTUBE_API_KEY1=your_youtube_api_key1
YOUTUBE_API_KEY2=your_youtube_api_key2
YOUTUBE_API_KEY3=your_youtube_api_key3
TWITTER_ACCESS_TOKEN=your_twitter_access_token

# Database configuration
MONGODB_URI=mongodb+srv://username:password@your-cluster.mongodb.net/
MONGODB_DB_NAME=youtube_monitor

# Twitter posting configuration
TWITTER_DRY_RUN=false  # Set to true to log tweets without actually posting
```

### Database Setup

The plugin will automatically create the necessary collections in MongoDB when it runs. Make sure your MongoDB URI is correct and accessible.

## How to Run

1. Configure your environment (see Setup above)
2. Navigate to the plugin directory: `cd /root/yuna/game-node/plugins/youtubePlugin`
3. Run with: `npx ts-node src/agent.ts`

The agent will start up, connect to MongoDB, and immediately begin discovering trending creators to track. It will continue running indefinitely, monitoring channels and posting updates according to the schedule.

## Customization

You can customize the monitoring behavior by adjusting the following:

### Monitoring Tiers

- **Tier 1**: Currently trending channels (checked every 30 minutes)
- **Tier 2**: Recently trending channels (checked every 2 hours)
- **Tier 3**: Previously trending channels (checked once daily)

### Twitter Integration

- Set `TWITTER_DRY_RUN=true` to test without posting actual tweets
- Set `TWITTER_DRY_RUN=false` to post live tweets

### API Key Management

The plugin automatically rotates between YouTube API keys when rate limits are encountered. Provide at least one key, but adding multiple keys is recommended for better reliability.

## Troubleshooting

**No channels showing up?**
- Make sure your YouTube API keys are valid
- Check the console logs for any error messages related to the YouTube API
- Verify your MongoDB connection is working

**Twitter posts not appearing?**
- Check the `TWITTER_DRY_RUN` setting (should be `false` for actual posting)
- Verify your Twitter access token is valid and has the right permissions
- Set up the Twitter client by running `node fix-twitter.js`

## Advanced

The plugin uses adaptive thresholds based on channel size:

- Small channels get more sensitive thresholds to detect smaller changes
- Large channels require more significant changes before triggering updates
- All thresholds are adjusted based on subscriber count, view count, etc.

## License

MIT