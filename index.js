require('dotenv').config();

const express = require('express');
const MongoClient = require('mongodb').MongoClient;
const SpotifyWebApi = require('spotify-web-api-node');

const app = express();
app.set('view engine', 'ejs');

console.log(process.env.SPOTIFY_CLIENT_ID); // should print your Spotify client ID
console.log(process.env.SPOTIFY_CLIENT_SECRET); // should print your Spotify client secret
console.log(process.env.MONGODB_URL); // should print your MongoDB URL
// Spotify API setup
const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
});
// Function to retrieve an access token 
function retrieveAccessToken() {
  spotifyApi.clientCredentialsGrant().then(function (data) {
    console.log('The access token expires in ' + data.body['expires_in']);
    console.log('The access token is ' + data.body['access_token']);
    // Save the access token so that it's used in future calls
    spotifyApi.setAccessToken(data.body['access_token']);

    // Set a timer to retrieve a new access token when the current one expires
    setTimeout(retrieveAccessToken, (data.body['expires_in'] - 300) * 1000); // 300 seconds buffer
  },
    function (err) {
      console.log('Something went wrong when retrieving an access token', err);
    }
  );
}

// Retrieve an access token as soon as the app starts 
retrieveAccessToken();
// MongoDB setup
const url = process.env.MONGODB_URL;
const dbName = 'weddingSongs';
let db;

const connectDB = async () => {
  try {
    const client = await MongoClient.connect(url);
    console.log("Connected successfully to server");
    db = client.db(dbName);
  } catch (err) {
    console.error(err);
  }
};

connectDB();
// MongoClient.connect(url, { useNewUrlParser: true, useUnifiedTopology: true },  function(err, client) {
//   console.log("Connected successfully to server");
//   db = client.db(dbName);
// });

// Route to fetch data from Spotify and store in MongoDB
app.get('/fetch', async (req, res) => {
  if (!db) {
    return res.status(500).send('Database not connected');
  }
  let skipCount = 0;
  let WwritingSongCount = 0;
  console.log("Fetching data from Spotify and storing in MongoDB");
  const data = await spotifyApi.searchPlaylists('wedding');
  console.log("spotify fetch completed with ", { data });
  console.log("Total Playlist found: ", data.body.playlists.total);
  const playlists = data.body.playlists.items;
  console.log("reading playlists");
  for (let playlist of playlists) {
    const response = await spotifyApi.getPlaylistTracks(playlist.id);
    const tracks = response.body.items;
    console.log("reading tracks");
    for (let track of tracks) {
      const artistResponse = await spotifyApi.getArtist(track.track.artists[0].id);
      const albumResponse = await spotifyApi.getAlbum(track.track.album.id);
      let skipCount = 0;
      let WwritingSongCount = 0;
      const song = {
        name: track.track.name,
        artist: track.track.artists[0].name,
        genre: artistResponse.body.genres[0], // Get the first genre of the artist
        year: new Date(albumResponse.body.release_date).getFullYear(), // Get the release year of the album
        popularity: track.track.popularity,// Save the popularity of the track
        imageUrl: track.track.album.images[0].url, // Save the URL of the album cover image
      };

      // Check if the song already exists in the database
      const songExists = await db.collection('songs').findOne({ name: song.name, artist: song.artist });

      if (!songExists) {
        WwritingSongCount = WwritingSongCount + 1;
        console.log("writing song to db");
        await db.collection('songs').insertOne(song);
        console.log(`${song.name} written to db`);
      } else {
        skipCount = skipCount + 1;
        console.log(`${song.name} already exists in db, skipping Song`);
      }
    }
  }

  console.log("function completed");
  res.send('Data fetched and stored in MongoDB');
});

//route to get songs from db with pagination.
app.get('/songs', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const pageSize = parseInt(req.query.pageSize) || 5;
  const year = parseInt(req.query.year);
  const genre = req.query.genre;

  const query = {};
  if (year) {
    query.year = year;
  }
  if (genre) {
    query.genre = genre;
  }

  const totalSongs = await db.collection('songs').countDocuments(query);
  const totalPages = Math.ceil(totalSongs / pageSize);

  const songs = await db.collection('songs')
    .find(query)
    .sort({ popularity: -1 }) // Sort by popularity in descending order
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .toArray();

  res.json({ songs, totalPages });
});
app.get('/genres', async (req, res) => {
  const genres = await db.collection('songs')
    .distinct('genre');
  res.json(genres);
});

app.get('/years', async (req, res) => {
  const years = await db.collection('songs')
    .distinct('year');
  res.json(years);
});
// Route to display data from MongoDB
app.get('/', async (req, res) => {
  try {
    if (!db) {
      return res.status(500).send('Database not connected');
    }

    const songs = await db.collection('songs').find().toArray();

    if (songs.length === 0) {
      return res.render('index', { message: 'No songs available' });
    }

    res.render('index', { songs });
  } catch (error) {
    console.error(error);
    res.status(500).send('An error occurred');
  }
});
// Function to fetch songs based on genre
async function getSongsByGenre(genre) {
  try {
    const regex = new RegExp(genre, 'i'); // Create a case-insensitive regex
    const songs = await db.collection('songs')
      .find({ genre: regex }) // Use the regex in the query
      .sort({ popularity: -1 })
      .limit(10)
      .toArray();
    return songs;
  } catch (error) {
    console.error(`Failed to fetch songs: ${error}`);
    return [];
  }
}

// Routes for each genre
app.get('/most-popular-country-wedding-songs', async (req, res) => {
  const songs = await getSongsByGenre('country');
  res.render('songs', { title: 'Most Popular Country Wedding Songs', songs: songs });
});

app.get('/most-popular-rnb-wedding-songs', async (req, res) => {
  const songs = await getSongsByGenre('r&b');
  res.render('songs', { title: 'Most Popular R&B Wedding Songs', songs: songs });
});

app.get('/most-popular-hip-hop-wedding-songs', async (req, res) => {
  const songs = await getSongsByGenre('hip hop');
  res.render('songs', { title: 'Most Popular Hip Hop Wedding Songs', songs: songs });
});

app.get('/most-popular-rock-wedding-songs', async (req, res) => {
  const songs = await getSongsByGenre('rock');
  res.render('songs', { title: 'Most Popular Rock Wedding Songs', songs: songs });
});

app.get('/most-popular-jazz-wedding-songs', async (req, res) => {
  const songs = await getSongsByGenre('jazz');
  res.render('songs', { title: 'Most Popular Jazz Wedding Songs', songs: songs });
});

app.get('/most-popular-pop-wedding-songs', async (req, res) => {
  const songs = await getSongsByGenre('pop');
  res.render('songs', { title: 'Most Popular Pop Wedding Songs', songs: songs });
});

app.get('/most-popular-jazz-wedding-songs', async (req, res) => {
  const songs = await getSongsByGenre('jazz');
  res.render('songs', { title: 'Most Popular Jazz Wedding Songs', songs: songs });
});

app.get('/most-popular-reggae-wedding-songs', async (req, res) => {
  const songs = await getSongsByGenre('reggae');
  res.render('songs', { title: 'Most Popular Reggae Wedding Songs', songs: songs });
});

app.listen(9000, () => console.log('App is listening on port 9000'));