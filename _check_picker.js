// Test the pickBuffer random logic from fx.js (logic only, no audio)
const files = ["pat.ogg", "pat1.ogg", "pat2.ogg"];
const avoidImmediateRepeat = true;
const lastPicked = {};
const counts = {};
files.forEach(f => counts[f] = 0);

function pickBuffer(group) {
    const ready = files;
    if (!ready.length) return null;

    let pool = ready;
    if (avoidImmediateRepeat && ready.length > 1) {
        pool = ready.filter((file) => file !== lastPicked[group]);
    }

    const file = pool[Math.floor(Math.random() * pool.length)];
    lastPicked[group] = file;
    return file;
}

const sequence = [];
for (let i = 0; i < 3000; i++) {
    const picked = pickBuffer("pat");
    sequence.push(picked);
    counts[picked]++;
}

// Check: all 3 files appear
const allAppear = files.every(f => counts[f] > 0);
console.log("All 3 files appear:", allAppear);
console.log("Counts:", counts);

// Check: no immediate repeats
let hasRepeat = false;
for (let i = 1; i < sequence.length; i++) {
    if (sequence[i] === sequence[i - 1]) {
        hasRepeat = true;
        console.log(`REPEAT at index ${i}: ${sequence[i]}`);
        break;
    }
}
console.log("No immediate repeats:", !hasRepeat);

// Check: not a repeating cycle (e.g. 0,1,2,0,1,2)
// Take the first 6 picks. If it's a simple cycle, the pattern length is 2 or 3.
let isCycle = false;
for (const cycleLen of [2, 3]) {
    let matches = true;
    for (let i = cycleLen; i < sequence.length; i++) {
        if (sequence[i] !== sequence[i % cycleLen]) {
            matches = false;
            break;
        }
    }
    if (matches) {
        isCycle = true;
        console.log(`Detected repeating cycle of length ${cycleLen}`);
    }
}
console.log("Not a repeating cycle:", !isCycle);

if (allAppear && !hasRepeat && !isCycle) {
    console.log("\nALL CHECKS PASSED (logic-only test, no audio)");
} else {
    console.log("\nSOME CHECKS FAILED");
    process.exit(1);
}
