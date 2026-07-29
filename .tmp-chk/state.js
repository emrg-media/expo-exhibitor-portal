const fs=require("fs"), path=require("path");
const env=fs.readFileSync(path.join(__dirname,"..","..","emrg-proposal-generator",".env.local"),"utf8");
const {google}=require("googleapis");
const credentials=JSON.parse(Buffer.from(env.match(/^GOOGLE_SERVICE_ACCOUNT_KEY=(.*)$/m)[1].trim(),"base64").toString("utf8"));
const auth=new google.auth.GoogleAuth({credentials,scopes:["https://www.googleapis.com/auth/spreadsheets"]});
const sheets=google.sheets({version:"v4",auth});
const sheetId="11xIbmatjYLcsyDzPz43h3uqB6Lk7qyJ78rPfTXp_l4s";
const read=async(r)=>((await sheets.spreadsheets.values.get({spreadsheetId:sheetId,range:r,valueRenderOption:"FORMATTED_VALUE"})).data.values||[]);
(async()=>{
  const tabs=(await sheets.spreadsheets.get({spreadsheetId:sheetId})).data.sheets.map(s=>s.properties.title);
  console.log("tabs:",tabs.join(" | "));
  for (const [tab,rng,sum] of [["Master","A2:T","V1:Y1"],["Electric","A2:J","L1:O1"],["Wi-Fi","A2:G","I1:L1"],["Lead Retrieval","A2:H","J1:M1"]]) {
    const rows=(await read(`${tab}!${rng}`)).filter(r=>r.some(c=>String(c).trim()!==""));
    console.log(`${tab.padEnd(15)} rows: ${rows.length}  |  ${((await read(`${tab}!${sum}`))[0]||[]).join(" | ")}`);
  }
})().catch(e=>{console.error("FAILED:",e.message);process.exit(1)});
