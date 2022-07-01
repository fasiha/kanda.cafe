import cors from 'cors';
import {createHash} from 'crypto';
import express from 'express';
import {constants} from 'fs';
import {access, unlink, writeFile} from 'fs/promises';
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
  const reply = await fetch(
      CURTIZ_URL + '/api/v1/sentence?includeWord=1&includeClozes=1', {
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
});

app.post('/sentence', (req, res) => {
  const {sentence, data} = req.body || {};
  if (sentence && data && typeof sentence === 'string' &&
      typeof data === 'object' && Object.keys(data || {}).length > 0) {
    const md5 = createHash('md5').update(sentence).digest('hex');
    writeFile(`../data/${md5}.json`, JSON.stringify(req.body, null, 1));
    res.status(200).send('ok');
  } else {
    res.status(400).send('invalid json')
  }
});
app.delete('/sentence', (req, res) => {
  const {sentence} = req.body || {};
  if (sentence && typeof sentence === 'string') {
    const md5 = createHash('md5').update(sentence).digest('hex');
    const todelete = `../data/${md5}.json`;
    access(todelete, constants.F_OK | constants.W_OK)
        .then(() => unlink(todelete))
        .catch(() => {});
    res.status(200).send('ok');
  } else {
    res.status(400).send('invalid json')
  }
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
