import ghPages from 'gh-pages';

await new Promise((resolve, reject) => {
  ghPages.publish('dist', {
    branch: 'gh-pages',
    dest: '.',
    add: false,
    remove: ['**/*', '!v5/**'],
    message: 'Deploy V4 production',
  }, error => {
    if (error) reject(error);
    else resolve();
  });
});

console.log('[deploy] V4 production published without removing /v5/');
