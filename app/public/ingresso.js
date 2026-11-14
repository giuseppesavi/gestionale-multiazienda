'use strict';
document.getElementById('vai').addEventListener('submit', e => {
  e.preventDefault();
  const c = document.getElementById('codice').value.trim().toLowerCase();
  if (c) location.href = '/a/' + encodeURIComponent(c) + '/';
});
