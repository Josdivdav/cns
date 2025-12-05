const fs = require("fs");
const pdfExtract = require("pdf-extraction");

function parseQuestionsFromText(text) {
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

    const results = [];
    let current = null;

    const questionRegex = /^(\d+)\.\s*(.+)/;   // 1. What is...?
    const optionRegex = /^[A-D]\.\s*(.+)/;     // A. Option...

    for (const line of lines) {
        const q = line.match(questionRegex);
        const o = line.match(optionRegex);

        if (q) {
            if (current) results.push(current);
            current = {
                number: q[1],
                question: q[2],
                options: []
            };
        } else if (o && current) {
            current.options.push(o[1]);
        }
    }

    if (current) results.push(current);

    return results;
}

(async () => {
    const pdfPath = "Anatomy_Physiology_Objective_Questions (1).pdf";

    const buffer = fs.readFileSync(pdfPath);
    const data = await pdfExtract(buffer);

    const text = data.text;  // raw extracted text
    const questions = parseQuestionsFromText(text);

    fs.writeFileSync("extracted_questions.json", JSON.stringify(questions, null, 2));

    console.log(`Extracted ${questions.length} questions.`);
    console.log("Saved to extracted_questions.json");
})();
