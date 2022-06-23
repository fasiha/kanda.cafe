import cors from 'cors';
import express from 'express';
import fetch from 'isomorphic-fetch';

const CURTIZ_URL = 'http://127.0.0.1:8133';
const port = process.env['PORT'] || 3010;

const app = express();
app.use(cors());

app.use(express.json());

app.get('/', (req, res) => {
  res.send('GET /sentences/私の分');
});

app.get('/sentence/:sentence', async (req, res) => {
  const body = {sentence: req.params.sentence};
  const reply = await fetch(CURTIZ_URL + '/api/v1/sentence', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body)
  })
  const data = await reply.json();
  res.format({
    'text/plain': () => {res.send('hi curl\n' + JSON.stringify(data))},
    'text/html': () =>
        res.send(`Input: ${req.params.sentence}. Output:<br><pre>${
            JSON.stringify(data, null, 1)}</pre>`),
    'application/json': () => res.json(data)
  })
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
