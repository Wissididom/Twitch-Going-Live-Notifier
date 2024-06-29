import "dotenv/config";
import crypto from "crypto";
import express from "express";
import helmet from "helmet";

const app = express();

// Notification request headers
const TWITCH_MESSAGE_ID = "Twitch-Eventsub-Message-Id".toLowerCase();
const TWITCH_MESSAGE_TIMESTAMP =
  "Twitch-Eventsub-Message-Timestamp".toLowerCase();
const TWITCH_MESSAGE_SIGNATURE =
  "Twitch-Eventsub-Message-Signature".toLowerCase();
const MESSAGE_TYPE = "Twitch-Eventsub-Message-Type".toLowerCase();

// Notification message types
const MESSAGE_TYPE_VERIFICATION = "webhook_callback_verification";
const MESSAGE_TYPE_NOTIFICATION = "notification";
const MESSAGE_TYPE_REVOCATION = "revocation";

// Prepend this string to the HMAC that's created from the message
const HMAC_PREFIX = "sha256=";

let token = {
  access_token: null,
  expires_in: null,
  token_type: null,
};

let messageMapping = {};

async function getToken() {
  let clientCredentials = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${process.env.TWITCH_CLIENT_ID}&client_secret=${process.env.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`,
    {
      method: "POST",
    },
  );
  if (clientCredentials.status >= 200 && clientCredentials.status < 300) {
    let clientCredentialsJson = await clientCredentials.json();
    token = {
      access_token: clientCredentialsJson.access_token,
      expires_in: clientCredentialsJson.expires_in,
      token_type: clientCredentialsJson.token_type,
    };
    return token;
  }
}

async function getUser(clientId, accessToken, id) {
  let apiUrl = id
    ? `https://api.twitch.tv/helix/users?id=${id}`
    : `https://api.twitch.tv/helix/users`;
  let userResponse = await fetch(apiUrl, {
    headers: {
      "Client-ID": clientId,
      Authorization: `Bearer ${accessToken}`,
    },
  }).then((res) => res.json());
  return userResponse.data[0];
}

async function getStream(clientId, accessToken, id) {
  let apiUrl = id
    ? `https://api.twitch.tv/helix/streams?user_id=${id}`
    : `https://api.twitch.tv/helix/streams`;
  let streamResponse = await fetch(apiUrl, {
    headers: {
      "Client-ID": clientId,
      Authorization: `Bearer ${accessToken}`,
    },
  }).then((res) => res.json());
  return streamResponse.data[0];
}

app.use(helmet());

app.use(
  express.raw({
    type: "application/json",
  }),
);

app.get("/", (req, res) => res.send("Twitch EventSub Webhook Endpoint"));

app.post("/", async (req, res) => {
  let secret = process.env.EVENTSUB_SECRET;
  let message =
    req.headers[TWITCH_MESSAGE_ID] +
    req.headers[TWITCH_MESSAGE_TIMESTAMP] +
    req.body;
  let hmac =
    HMAC_PREFIX +
    crypto.createHmac("sha256", secret).update(message).digest("hex");

  if (verifyMessage(hmac, req.headers[TWITCH_MESSAGE_SIGNATURE])) {
    // Get JSON object from body, so you can process the message.
    let notification = JSON.parse(req.body);
    switch (req.headers[MESSAGE_TYPE]) {
      case MESSAGE_TYPE_NOTIFICATION:
        if (notification.subscription.type == "stream.online") {
          await getToken();
          let webhooks = JSON.parse(process.env.WEBHOOKS);
          notification.event.broadcaster_user_id = webhooks[0].twitch;
          let stream = await getStream(
            process.env.TWITCH_CLIENT_ID,
            token.access_token,
            notification.event.broadcaster_user_id,
          );
          let user = await getUser(
            process.env.TWITCH_CLIENT_ID,
            token.access_token,
            notification.event.broadcaster_user_id,
          );
          notification.event.broadcaster_user_login = user.login;
          notification.event.broadcaster_user_name = user.display_name;
          let embed = {
            url: `https://www.twitch.tv/${notification.event.broadcaster_user_login}`,
            title: stream?.title ?? "N/A",
            color: 6570404,
            timestamp: new Date(),
            fields: [
              {
                name: "Game",
                value: stream?.game_name ?? "N/A",
                inline: true,
              },
              {
                name: "Viewers",
                value: (stream?.viewer_count ?? 0).toString(),
                inline: true,
              },
            ],
            author: {
              name: `${notification.event.broadcaster_user_name} is now live on Twitch!`,
              url: `https://www.twitch.tv/${notification.event.broadcaster_user_login}`,
              icon_url: user?.profile_image_url,
            },
            image: stream?.thumbnail_url
              ? {
                  url: stream?.thumbnail_url
                    ?.replace("{width}", "400")
                    ?.replace("{height}", "225"),
                  width: 400,
                  height: 225,
                }
              : undefined,
            footer: {
              text: "Made by Wissididom",
            },
          };
          let component = {
            type: 1,
            id: 1,
            components: [
              {
                type: 2,
                id: 2,
                style: 5,
                label: "Watch Stream",
                url: `https://www.twitch.tv/${notification.event.broadcaster_user_login}`,
              },
            ],
          };
          for (let webhook of webhooks) {
            if (webhook.twitch != notification.event.broadcaster_user_id)
              continue;
            let response = await fetch(`${webhook.url}?wait=true`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                content: webhook.discord,
                embeds: [embed],
                components: [component],
              }),
            });
            let json = undefined;
            if (
              response.headers
                .get("content-type")
                .startsWith("application/json")
            )
              json = await response.json();
            messageMapping[`${webhook.twitch}|${webhook.url}`] = json;
            console.log(
              `stream.online - ${response.status} - ${json ? JSON.stringify(json) : await response.text()}`,
            );
          }
        } else if (notification.subscription.type == "stream.offline") {
          let webhooks = JSON.parse(process.env.WEBHOOKS);
          notification.event.broadcaster_user_id = webhooks[0].twitch;
          for (let webhook of webhooks) {
            if (webhook.twitch != notification.event.broadcaster_user_id)
              continue;
            if (!messageMapping[`${webhook.twitch}|${webhook.url}`]) continue;
            let msgId = messageMapping[`${webhook.twitch}|${webhook.url}`].id;
            let response = await fetch(`${webhook.url}/messages/${msgId}`, {
              method: "DELETE",
            });
            let json = undefined;
            if (
              response.headers
                .get("content-type")
                .startsWith("application/json")
            )
              json = await response.json();
            delete messageMapping[`${webhook.twitch}|${webhook.url}`];
            console.log(
              `stream.offline - ${response.status} - ${json ? JSON.stringify(json) : await response.text()}`,
            );
          }
        } else {
          console.log(`Event type: ${notification.subscription.type}`);
          console.log(JSON.stringify(notification.event, null, 4));
        }
        res.sendStatus(204);
        break;
      case MESSAGE_TYPE_VERIFICATION:
        res
          .set("Content-Type", "text/plain")
          .status(200)
          .send(notification.challenge);
        break;
      case MESSAGE_TYPE_REVOCATION:
        res.sendStatus(204);
        console.log(`${notification.subscription.type} notifications revoked!`);
        console.log(`reason: ${notification.subscription.status}`);
        console.log(
          `condition: ${JSON.stringify(notification.subscription.condition, null, 4)}`,
        );
        break;
      default:
        res.sendStatus(204);
        console.log(`Unknown message type: ${req.headers[MESSAGE_TYPE]}`);
        break;
    }
  } else {
    console.log("403 - Signatures didn't match.");
    res.sendStatus(403);
  }
});

function verifyMessage(hmac, verifySignature) {
  return crypto.timingSafeEqual(
    Buffer.from(hmac),
    Buffer.from(verifySignature),
  );
}

const port = process.env.PORT || 3000;

app.listen(port, () => console.log(`Server ready on port ${port}.`));

export default app;
