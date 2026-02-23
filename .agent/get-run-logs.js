const https = require('https');
const fs = require('fs');

const runId = '22292660350';
const url = `https://api.github.com/repos/uingga/flight/actions/runs/${runId}/jobs`;

const options = {
  headers: {
    'User-Agent': 'Node.js',
    'Accept': 'application/vnd.github.v3+json'
  }
};

https.get(url, options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      const jobs = json.jobs;
      if (!jobs || jobs.length === 0) {
        console.log('No jobs found'); return;
      }
      const job = jobs[0];
      console.log('Job Name:', job.name);
      console.log('Status:', job.status, 'Conclusion:', job.conclusion);

      const logUrl = `https://api.github.com/repos/uingga/flight/actions/jobs/${job.id}/logs`;

      https.get(logUrl, options, (logRes) => {
        if (logRes.statusCode === 302) {
          const redirectUrl = logRes.headers.location;
          https.get(redirectUrl, (finalRes) => {
            let logData = '';
            finalRes.on('data', c => logData += c);
            finalRes.on('end', () => {
              const lines = logData.split('\n');
              const errorLines = lines.filter(l => l.match(/error|fail|exception|timeout/i)).slice(-50);
              const tailLines = lines.slice(-100);
              fs.writeFileSync('job_logs.txt', '--- ERROR LINES ---\n' + errorLines.join('\n') + '\n\n--- TAIL LINES ---\n' + tailLines.join('\n'));
              console.log('Logs saved to job_logs.txt. Parsed ' + lines.length + ' lines.');
            });
          });
        } else {
          console.log('Expected redirect but got', logRes.statusCode);
        }
      });
    } catch (e) {
      console.error(e);
    }
  });
}).on('error', console.error);
