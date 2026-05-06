const c=require('fs').readFileSync('public/app.js','utf8');
const start=213759;
let i=start, depth=0;
while(i<c.length){
  const ch=c[i];
  if(ch==='{') depth++;
  else if(ch==='}'){
    depth--;
    if(depth===0){ 
      console.log('Balanced at offset:',i); 
      console.log(JSON.stringify(c.slice(i,i+100))); 
      break; 
    }
  }
  i++;
}
