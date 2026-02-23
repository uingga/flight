
const https = require('https');
const options = {
  headers: {
    'User-Agent': 'Node.js',
    'Accept': 'application/vnd.github.v3+json'
  }
};
// Fetch the jobs for run 22292660350
https.get('https://api.github.com/repos/uingga/flight/actions/runs/22292660350/jobs', options, (res) => {
    let data = '';
    res.on('data', c => data+=c);
    res.on('end', () => {
        try {
            const jobs = JSON.parse(data).jobs;
            const job = jobs[0];
            console.log('Job:', job.name, job.status, job.conclusion);
            if (job.steps) {
                job.steps.forEach(s => {
                    if (s.conclusion === 'failure') {
                        console.log('Failing Step:', s.name);
                    }
                });
            }
        } catch(e) { console.error(e); }
    });
});

