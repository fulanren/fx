// src/utils/searchEngine.js
export function createSearchEngine() {
    let documents = [];
    let invertedIndex = new Map();

    function tokenize(text) {
        if (!text) return [];
        const cleanText = text.replace(/<[^>]+>/g, ' ').toLowerCase();
        const tokens = [];
        const enMatches = cleanText.match(/[a-z0-9]+/g) || [];
        tokens.push(...enMatches);
        const zhMatches = cleanText.match(/[\u4e00-\u9fa5]+/g) || [];
        zhMatches.forEach(zhStr => {
            for (let i = 0; i < zhStr.length; i++) {
                tokens.push(zhStr[i]);
                if (i < zhStr.length - 1) tokens.push(zhStr.substring(i, i + 2));
            }
        });
        return tokens;
    }

    function buildIndex(points, tasks, chapters) {
        documents = [];
        invertedIndex.clear();

        // 索引卡片
        points.forEach(p => {
            if (p.deletedAt) return;
            const content = p.content || '';
            const explanation = p.explanation || '';
            const plainText = `${content} ${explanation}`.replace(/<[^>]+>/g, '').toLowerCase();

            const doc = { id: p.id, type: 'point', title: content, raw: p };
            documents.push(doc);

            const tokens = tokenize(plainText);
            new Set(tokens).forEach(token => {
                if (!invertedIndex.has(token)) invertedIndex.set(token, new Set());
                invertedIndex.get(token).add(doc.id);
            });
        });

        // 索引文件夹
        tasks.forEach(t => {
            if (t.deletedAt) return;
            const doc = { id: t.id, type: 'task', title: t.name, raw: t };
            documents.push(doc);
            new Set(tokenize(t.name)).forEach(token => {
                if (!invertedIndex.has(token)) invertedIndex.set(token, new Set());
                invertedIndex.get(token).add(doc.id);
            });
        });

        // 索引子文件夹
        chapters.forEach(c => {
            if (c.deletedAt) return;
            const doc = { id: c.id, type: 'chapter', title: c.name, raw: c };
            documents.push(doc);
            new Set(tokenize(c.name)).forEach(token => {
                if (!invertedIndex.has(token)) invertedIndex.set(token, new Set());
                invertedIndex.get(token).add(doc.id);
            });
        });
    }

    function search(query) {
        if (!query) return [];
        const qTokens = tokenize(query);
        if (qTokens.length === 0) return [];

        let resultSets = [];
        qTokens.forEach(token => {
            const matches = invertedIndex.get(token);
            if (matches) resultSets.push(matches);
        });

        if (resultSets.length === 0) return [];

        let intersection = new Set(resultSets[0]);
        for (let i = 1; i < resultSets.length; i++) {
            intersection = new Set([...intersection].filter(id => resultSets[i].has(id)));
        }

        return documents.filter(doc => intersection.has(doc.id));
    }

    return { buildIndex, search };
}