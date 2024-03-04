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
  redirectUri: process.env.SPOTIPY_REDIRECT_URI,
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
//retrieveAccessToken();
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
        spotifyId: track.track.id,
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
        if (!songExists.spotifyId) {
          // If not, update the song to include the spotifyId
          await db.collection('songs').updateOne({ _id: songExists._id }, { $set: { spotifyId: song.spotifyId } });
          console.log(`Added spotifyId to ${song.name} in db`);
        }
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

    const genres = ['country', 'r&b', 'hip hop', 'rock', 'disco', 'pop', 'edm'];
    const routes = await Promise.all(genres.map(async (genre) => {
    const songs = await getSongsByGenre(genre);
    return {
      name: genre,
      title: `Most Popular ${genre.charAt(0).toUpperCase() + genre.slice(1)} Wedding Songs`,
      songs: songs,
      path: `/most-popular-${genre.replace(/&/g, 'and').replace(/\s/g, '-')}-wedding-songs`
    };
  }));
    res.render('index', { routes });
  } catch (error) {
    console.error(error);
    res.status(500).send('An error occurred');
  }
});
// Function to fetch songs based on genre
async function getSongsByGenre(genre, limit = 9) {
  try {
    const regex = new RegExp(genre, 'i'); // Create a case-insensitive regex
    if(genre=='top'){
      const songs = await db.collection('songs')
      .find() // Use the regex in the query
      .sort({ popularity: -1 })
      .limit(limit)
      .toArray();
    }
    const songs = await db.collection('songs')
      .find({ genre: regex }) // Use the regex in the query
      .sort({ popularity: -1 })
      .limit(limit)
      .toArray();
    return songs;
  } catch (error) {
    console.error(`Failed to fetch songs: ${error}`);
    return [];
  }
}

async function createPlaylist(title, description) {
  try {
    const data = await spotifyApi.createPlaylist(title, {
      description: description,
      public: true
    });
    return data.body.id;
  } catch (error) {
    console.error(`Failed to create playlist ${title}:`, error);
  }
}
app.get('/create-playlist', async (req, res) => {
  const genres = ['country', 'r&b', 'hip hop', 'rock', 'disco', 'pop', 'edm'];
  for (let genre of genres) {
    const songs = await getSongsByGenre(genre, 25);
    console.log("Songs of genre "+genre,{songs});
    const title = `Most Popular ${genre.charAt(0).toUpperCase() + genre.slice(1)} Wedding Songs`;
    const description= "This is a playlist of top wedding songs in "+ genre;
    console.log(`Processing ${title}...`);

    // Check if the playlist already exists in the database
    const existingPlaylist = await db.collection('playlists').findOne({ title: title });
    if (existingPlaylist) {
      console.log(`Playlist ${title} already exists, skipping...`);
      continue;
    }

    
    const songUris = songs
  .filter(song => song.spotifyId !== undefined)
  .map(song => 'spotify:track:' + song.spotifyId);
    console.log({songUris})
    // Create a playlist
    let playlistId;
try {
  playlistId = await createPlaylist(title, description);
} catch (error) {
  console.error(`Failed to create playlist ${title}:`, error);
  continue;
}

if (!playlistId) {
  console.error(`No response received when creating playlist ${title}`);
  continue;
}
console.log({playlistId});
// Add tracks to the playlist
console.log(`Adding tracks to playlist ${title}...`);
try {
  console.log({playlistId});
  await spotifyApi.addTracksToPlaylist(playlistId, songUris);
} catch (error) {
  console.error(`Failed to add tracks to playlist ${title}:`, error);
  continue;
}
    // Save the playlist details in the database
    console.log(`Saving playlist ${title} to the database...`);
    const collection = db.collection('playlists');
    await collection.insertOne({ title: title, spotifyId: playlistId });

    console.log(`Finished processing ${title}`);
  }
});
// Routes for each genre
app.get('/top-wedding-songs', async (req, res) => {
  const songs = await db.collection('songs')
  .find()
  .sort({ popularity: -1 })
  .limit(25)
  .toArray();
  res.render('songs', { title: 'Top Wedding Songs', songs: songs });
});
app.get('/most-popular-randb-wedding-songs', async (req, res) => {
  const title = 'Most Popular R&b Wedding Songs';
  const songs = await getSongsByGenre('r&b', 24);
  const playlistId = await getPlaylistId(title);
  res.render('songs', { title: title, songs: songs, playlistId: playlistId });
});

app.get('/most-popular-hip-hop-wedding-songs', async (req, res) => {
  const title = 'Most Popular Hip hop Wedding Songs';
  const songs = await getSongsByGenre('hip hop', 24);
  const playlistId = await getPlaylistId(title);
  res.render('songs', { title: title, songs: songs, playlistId: playlistId });
});

app.get('/most-popular-rock-wedding-songs', async (req, res) => {
  const title = 'Most Popular Rock Wedding Songs';
  const songs = await getSongsByGenre('rock', 24);
  const playlistId = await getPlaylistId(title);
  res.render('songs', { title: title, songs: songs, playlistId: playlistId });
});

app.get('/most-popular-disco-wedding-songs', async (req, res) => {
  const title = 'Most Popular Disco Wedding Songs';
  const songs = await getSongsByGenre('disco', 24);
  const playlistId = await getPlaylistId(title);
  res.render('songs', { title: title, songs: songs, playlistId: playlistId });
});

app.get('/most-popular-pop-wedding-songs', async (req, res) => {
  const title = 'Most Popular Pop Wedding Songs';
  const songs = await getSongsByGenre('pop', 24);
  const playlistId = await getPlaylistId(title);
  res.render('songs', { title: title, songs: songs, playlistId: playlistId });
});

app.get('/most-popular-country-wedding-songs', async (req, res) => {
  const title = 'Most Popular Country Wedding Songs';
  const songs = await getSongsByGenre('country', 24);
  const playlistId = await getPlaylistId(title);
  res.render('songs', { title: title, songs: songs, playlistId: playlistId });
});

app.get('/most-popular-edm-wedding-songs', async (req, res) => {
  const title = 'Most Popular EDM Wedding Songs';
  const songs = await getSongsByGenre('edm', 24);
  const playlistId = await getPlaylistId(title);
  res.render('songs', { title: title, songs: songs, playlistId: playlistId });
});
async function getPlaylistId(title) {
  const playlist = await db.collection('playlists').findOne({ title: title });
  return playlist ? playlist.spotifyId : null;
}
app.get('/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const data = await spotifyApi.authorizationCodeGrant(code);
    const { access_token: accessToken, refresh_token: refreshToken } = data.body;
    spotifyApi.setAccessToken(accessToken);
    spotifyApi.setRefreshToken(refreshToken);
    res.redirect('/');
  } catch (err) {
    console.log('Something went wrong!', err);
  }
});
app.get('/login', (req, res) => {
  const scopes = ['playlist-modify-public'];
  const authorizeURL = spotifyApi.createAuthorizeURL(scopes);
  res.redirect(authorizeURL);
});
app.listen(9000, () => console.log('App is listening on port 9000'));