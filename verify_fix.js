
const toStr = (d) => {
    if (!d) return '';
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

// Simulate selecting "2026-02-11"
const selectedString = "2026-02-11";
console.log(`\nTesting with date string: "${selectedString}"`);

const toDate = (s) => s ? new Date(s + 'T00:00:00') : null;
const dateObj = toDate(selectedString);

console.log(`Date Object (Local): ${dateObj.toString()}`);

// Now test new toStr which should fix the issue
const resultString = toStr(dateObj);
console.log(`Result String from new toStr(): "${resultString}"`);

if (selectedString === resultString) {
    console.log("SUCCESS: Date preserved correctly!");
} else {
    console.log(`FAILURE: Date shifted! Expected ${selectedString}, got ${resultString}`);
}
