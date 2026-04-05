require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getResumeText } = require('./utils/resumeQA');

getResumeText().then(t => {
    if (t) {
        console.log('SUCCESS: Resume loaded,', t.length, 'chars');
        console.log('Preview:', t.substring(0, 300));
    } else {
        console.log('FAIL: No resume text returned');
    }
}).catch(e => {
    console.error('ERROR:', e.message);
});
