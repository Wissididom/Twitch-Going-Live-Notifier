# Twitch-Going-Live-Notifier

## Prerequisites

- NodeJS v18+
- Twitch Client ID
- Twitch Client Secret
- Port on the server where Twitch sends the webhooks to
  - only matters for installation on your server; doesn't matter for deployments on Vercel
- EventSub Secret (must be between 1 and 100 chars in length and can be freely chosen by you)
- Hostname or IP where Twitch sends the webhooks to (`URL` environment variable or value in the `.env` file)
- Webhook Information: Array of objects with the properties url, twitch, discord, where `url` is the discord webhook url, `twitch` is the twitch user id and `discord` is the message content for that notification

## Setup

### Hosted on your server

1. Clone this repo
2. Do `npm i` or `npm install` to install `dotenv`, `express` and `helmet`
3. Copy `example.env` to `.env` and fill out it's values
4. Run `node api/index.js` or `npm start` and let it run in the background (Twitch sends a verification request after creating the EventSub subscription)
5. Run `node create-online-eventsub-subscription.js` and enter the name of the channel you want to create an EventSub subscription of `channel.raid` for
7. Twitch now tries to send an verification request to your specified URL and if that succeeds will send you a POST request on each `stream.online` and `stream.offline` event

### Hosted on Vercel

1. Fork this repo
2. Import your Fork to Vercel
3. Create the environment variables from `example.env` on Vercel's settings page
4. Redeploy to make sure Vercel uses those environment variables
5. Do step 5 from the `Hosted on your server` section locally with the same values that you have specified on Vercel as environment variables
6. Twitch now tries to send an verification request to your specified URL and if that succeeds will send you a POST request on each outgoing raid

### If you want to cleanup messages after the stream went offline

1. Run `node create-offline-eventsub-subscription.js` after you've followed the steps from either `Hosted on your server` or `Hosted on Vercel`
2. The script will cleanup the message after the stream went offline (keep in mind that the message id is stored in memory, so it will not work if the script was stopped during a stream)
