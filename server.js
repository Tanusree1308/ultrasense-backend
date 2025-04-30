require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const bodyParser = require('body-parser');
const { MongoClient } = require('mongodb');

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));

const uri = process.env.MONGO_URI;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const DISTANCE_LIMIT = 100;

async function connectMongoDB() {
  try {
    await client.connect();
    console.log("✅ Connected to MongoDB Atlas");
  } catch (err) {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  }
}
connectMongoDB();

app.post('/register-token', async (req, res) => {
  const { token, experienceId } = req.body;
  if (!token || !experienceId) {
    return res.status(400).send('Token and experienceId are required');
  }

  console.log('Expo Push Token registered:', token, 'with experienceId:', experienceId);

  try {
    const collection = client.db("ultrasense").collection("push_tokens");
    await collection.updateOne(
      { token },
      { $set: { token, experienceId, registeredAt: new Date() } },
      { upsert: true }
    );
    res.send('✅ Token received and stored');
  } catch (error) {
    console.error('❌ Error storing token:', error);
    res.status(500).send('Error storing token');
  }
});

app.post('/distance', async (req, res) => {
  const { distance } = req.body;

  if (distance == null || isNaN(distance)) {
    return res.status(400).send('Invalid distance value');
  }

  console.log(`📏 Distance received: ${distance} cm`);

  try {
    const collection = client.db("ultrasense").collection("distance_data");
    await collection.insertOne({ distance, timestamp: new Date() });

    if (distance >= DISTANCE_LIMIT) {
      await sendPushNotifications(distance);
    }

    res.send('✅ Distance processed and stored');
  } catch (error) {
    console.error('❌ Error storing distance data:', error);
    res.status(500).send('Error storing distance data');
  }
});

app.get('/latest-distance', async (req, res) => {
  try {
    const collection = client.db("ultrasense").collection("distance_data");
    const latest = await collection.find().sort({ timestamp: -1 }).limit(1).toArray();

    if (latest.length === 0) {
      return res.status(404).send('No data');
    }

    res.json({ distance: latest[0].distance });
  } catch (error) {
    console.error('❌ Error fetching distance:', error);
    res.status(500).send('Internal server error');
  }
});

async function sendPushNotifications(distance) {
  const tokens = await client.db("ultrasense").collection("push_tokens").find().toArray();

  // Group tokens by experienceId
  const grouped = tokens.reduce((acc, { token, experienceId }) => {
    acc[experienceId] = acc[experienceId] || [];
    acc[experienceId].push(token);
    return acc;
  }, {});

  for (const [experienceId, tokenList] of Object.entries(grouped)) {
    const messages = tokenList.map(token => ({
      to: token,
      sound: 'default',
      title: '🚨 Distance Alert!',
      body: `Object detected at ${distance.toFixed(2)} cm.`,
      data: { distance },
      _experienceId: experienceId
    }));

    try {
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messages),
      });

      const data = await response.json();
      console.log(`📤 Push notification response for ${experienceId}:`, data);

      if (data.errors) {
        console.error('❌ Notification errors:', data.errors);
      }
    } catch (err) {
      console.error(`❌ Error sending push to ${experienceId}:`, err);
    }
  }
}

app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 Server running at http://0.0.0.0:${port}`);
});
