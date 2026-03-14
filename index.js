const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({ origin: '*', methods: '*', allowedHeaders: '*' }));
app.use(bodyParser.text({ type: '*/*' }));
app.use(express.static(path.join(__dirname, 'public')));

const store = { events: {}, contacts: {} };

app.get('/api/events', (req, res) => res.json(Object.values(store.events)));

app.post('/api/events', (req, res) => {
  const data = JSON.parse(req.body);
  const uid = uuidv4();
  store.events[uid] = { uid, ...data };
  if (data.contact && data.contact.firstName) {
    const cuid = uuidv4();
    store.contacts[cuid] = { uid: cuid, ...data.contact };
  }
  res.json({ uid, success: true });
});

app.delete('/api/events/:uid', (req, res) => {
  delete store.events[req.params.uid];
  res.json({ success: true });
});

app.get('/api/contacts', (req, res) => res.json(Object.values(store.contacts)));

// CalDAV
app.options('/caldav/*', (req, res) => {
  res.set({ 'DAV': '1, 2, calendar-access', 'Allow': 'OPTIONS, GET, PUT, DELETE, PROPFIND, REPORT' }).status(200).end();
});

app.all('/caldav/calendar/', (req, res) => {
  if (req.method === 'PROPFIND') {
    const r = Object.values(store.events).map(e =>
      '<response><href>/caldav/calendar/' + e.uid + '.ics</href><propstat><prop>' +
      '<getetag>"' + e.uid + '"</getetag><getcontenttype>text/calendar</getcontenttype>' +
      '</prop><status>HTTP/1.1 200 OK</status></propstat></response>').join('');
    res.set('Content-Type','application/xml; charset=utf-8').status(207).send(
      '<?xml version="1.0" encoding="UTF-8"?><multistatus xmlns="DAV:">' +
      '<response><href>/caldav/calendar/</href><propstat><prop>' +
      '<resourcetype><collection/><calendar xmlns="urn:ietf:params:xml:ns:caldav"/></resourcetype>' +
      '<displayname>TaskFlow</displayname></prop><status>HTTP/1.1 200 OK</status></propstat></response>' + r + '</multistatus>');
  } else if (req.method === 'REPORT') {
    const r = Object.values(store.events).map(e =>
      '<response><href>/caldav/calendar/' + e.uid + '.ics</href><propstat><prop>' +
      '<calendar-data xmlns="urn:ietf:params:xml:ns:caldav">' + buildICS(e.uid, e) + '</calendar-data>' +
      '<getetag>"' + e.uid + '"</getetag></prop><status>HTTP/1.1 200 OK</status></propstat></response>').join('');
    res.set('Content-Type','application/xml; charset=utf-8').status(207).send(
      '<?xml version="1.0"?><multistatus xmlns="DAV:">' + r + '</multistatus>');
  } else { res.status(405).end(); }
});

app.get('/caldav/calendar/:uid.ics', (req, res) => {
  const e = store.events[req.params.uid];
  if (!e) return res.status(404).end();
  res.set('Content-Type', 'text/calendar').send(buildICS(e.uid, e));
});
app.put('/caldav/calendar/:uid.ics', (req, res) => {
  store.events[req.params.uid] = { uid: req.params.uid, raw: req.body };
  res.set('ETag', '"' + req.params.uid + '"').status(201).end();
});
app.delete('/caldav/calendar/:uid.ics', (req, res) => {
  delete store.events[req.params.uid]; res.status(204).end();
});

// CardDAV
app.all('/carddav/contacts/', (req, res) => {
  if (req.method === 'PROPFIND') {
    const r = Object.values(store.contacts).map(c =>
      '<response><href>/carddav/contacts/' + c.uid + '.vcf</href><propstat><prop>' +
      '<getetag>"' + c.uid + '"</getetag><getcontenttype>text/vcard</getcontenttype>' +
      '</prop><status>HTTP/1.1 200 OK</status></propstat></response>').join('');
    res.set('Content-Type','application/xml; charset=utf-8').status(207).send(
      '<?xml version="1.0"?><multistatus xmlns="DAV:">' +
      '<response><href>/carddav/contacts/</href><propstat><prop>' +
      '<resourcetype><collection/><addressbook xmlns="urn:ietf:params:xml:ns:carddav"/></resourcetype>' +
      '<displayname>TaskFlow</displayname></prop><status>HTTP/1.1 200 OK</status></propstat></response>' + r + '</multistatus>');
  } else { res.status(405).end(); }
});
app.get('/carddav/contacts/:uid.vcf', (req, res) => {
  const c = store.contacts[req.params.uid];
  if (!c) return res.status(404).end();
  res.set('Content-Type', 'text/vcard').send(buildVCF(c.uid, c));
});
app.put('/carddav/contacts/:uid.vcf', (req, res) => {
  store.contacts[req.params.uid] = { uid: req.params.uid, raw: req.body };
  res.set('ETag', '"' + req.params.uid + '"').status(201).end();
});
app.delete('/carddav/contacts/:uid.vcf', (req, res) => {
  delete store.contacts[req.params.uid]; res.status(204).end();
});

function buildICS(uid, data) {
  const now = new Date().toISOString().replace(/[-:]/g,'').split('.')[0] + 'Z';
  const date = (data.date || '2026-03-14').replace(/-/g,'');
  const time = (data.time || '090000').toString().replace(/:/g,'').substring(0,6);
  const name = data.contact ? ((data.contact.firstName||'') + ' ' + (data.contact.lastName||'')).trim() : '';
  return 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//TaskFlow//RU\r\n' +
    'BEGIN:VEVENT\r\nUID:' + uid + '\r\nDTSTAMP:' + now +
    '\r\nDTSTART;TZID=Europe/Moscow:' + date + 'T' + time +
    '\r\nSUMMARY:' + (data.title||'Событие') +
    '\r\nDESCRIPTION:' + name + '\r\nEND:VEVENT\r\nEND:VCALENDAR';
}
function buildVCF(uid, c) {
  return 'BEGIN:VCARD\r\nVERSION:3.0\r\nUID:' + uid +
    '\r\nFN:' + (c.firstName||'') + ' ' + (c.lastName||'') +
    '\r\nN:' + (c.lastName||'') + ';' + (c.firstName||'') + ';;;\r\n' +
    (c.phone ? 'TEL;TYPE=CELL:' + c.phone + '\r\n' : '') +
    (c.email ? 'EMAIL;TYPE=WORK:' + c.email + '\r\n' : '') +
    (c.company ? 'ORG:' + c.company + '\r\n' : '') +
    (c.jobTitle ? 'TITLE:' + c.jobTitle + '\r\n' : '') + 'END:VCARD';
}

app.listen(PORT, () => console.log('TaskFlow запущен на порту ' + PORT));