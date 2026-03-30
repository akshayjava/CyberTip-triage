const crypto = require("crypto");

// Mock Data
const N = 500; // rows
const M = 10;  // files per row

const dataResult = { rows: [] };
const allFiles = [];

for(let i=0; i<N; i++) {
    const tip_id = crypto.randomUUID();
    dataResult.rows.push({ tip_id });
    for(let j=0; j<M; j++) {
        allFiles.push({ tip_id, file_id: crypto.randomUUID() });
    }
}

console.time("O(N*M) filter");
for(let k=0; k<100; k++) {
    const tips1 = dataResult.rows.map((row) => {
        const files = allFiles.filter((f) => f.tip_id === row.tip_id);
        return { ...row, files };
    });
}
console.timeEnd("O(N*M) filter");

console.time("O(N+M) Map");
for(let k=0; k<100; k++) {
    const filesByTipId = new Map();
    for(const f of allFiles) {
        let arr = filesByTipId.get(f.tip_id);
        if(!arr) {
            arr = [];
            filesByTipId.set(f.tip_id, arr);
        }
        arr.push(f);
    }
    const tips2 = dataResult.rows.map((row) => {
        const files = filesByTipId.get(row.tip_id) || [];
        return { ...row, files };
    });
}
console.timeEnd("O(N+M) Map");

console.time("O(N+M) Object");
for(let k=0; k<100; k++) {
    const filesByTipId = {};
    for(let i=0; i<allFiles.length; i++) {
        const f = allFiles[i];
        if(!filesByTipId[f.tip_id]) filesByTipId[f.tip_id] = [];
        filesByTipId[f.tip_id].push(f);
    }
    const tips3 = dataResult.rows.map((row) => {
        const files = filesByTipId[row.tip_id] || [];
        return { ...row, files };
    });
}
console.timeEnd("O(N+M) Object");
