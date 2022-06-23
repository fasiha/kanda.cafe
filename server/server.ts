import express from 'express';
import fetch from 'isomorphic-fetch';
const CURTIZ_URL = 'http://127.0.0.1:8133';

const app = express();
const port = process.env['PORT'] || 3010;

app.use(express.json());

app.get('/', (req, res) => {
  res.send('Hello World!');
});

app.get('/sentence/:sentence', async (req, res) => {
  const body = {sentence: req.params.sentence};
  const reply = await fetch(CURTIZ_URL + '/api/v1/sentence', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body)
  })
  const rawReply = await reply.text();
  res.format({
    'text/html': () =>
        res.send(`Input: ${req.params.sentence}. Output:<br>${(rawReply)}`),
    'application/json': () => res.json(JSON.parse(rawReply))
  })
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
