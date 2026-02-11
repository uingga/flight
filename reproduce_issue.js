
const toDate = (s) => s ? new Date(s + 'T00:00:00') : null;
const toStr = (d) => {
    if (!d) return '';
    // This is the implementation in Dashboard.tsx
    return d.toISOString().slice(0, 10);
};

// Simulate selecting "2026-02-11"
const selectedString = "2026-02-11";
console.log(`\nTesting with date string: "${selectedString}"`);

// react-datepicker typically returns a Date object set to local midnight for the selected date
// But let's see what toDate does first.
const dateObj = toDate(selectedString);

console.log(`Date Object (toString - Local): ${dateObj.toString()}`);
console.log(`Date Object (toISOString - UTC): ${dateObj.toISOString()}`);

// Now test toStr which causes the issue
const resultString = toStr(dateObj);
console.log(`Result String from toStr(): "${resultString}"`);

if (selectedString !== resultString) {
    console.log("BUG REPRODUCED: Date shifted!");
    console.log(`Expected: ${selectedString}, Got: ${resultString}`);
} else {
    console.log("No bug found with this method alone (but check timezone offset).");
}

// Check timezone offset
const offset = new Date().getTimezoneOffset();
console.log(`System Timezone Offset (minutes): ${offset} (Postive means behind UTC, Negative means ahead ex. -540 for KST)`);
