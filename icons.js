// Small original outline glyphs for the Gravewright character sheet.
const paths={
 shield:['M12 2 21 6v6c0 5-4 8-9 10-5-2-9-5-9-10V6Z','M12 5 18 8v4c0 3-2 5-6 7-4-2-6-4-6-7V8Z'],
 swords:['m4 3 11 11-3 3L2 5Z','m16 3 5-1-1 5-6 6','m13 15 6 6','m10 16 6-6','m17 18 3-3','m3 21 6-6'],
 boot:['M8 3h7v9l5 4v4H3v-5h5Z','M8 7h7','M8 10h7','M3 17h17'],
 star:['m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z'],
 heart:['M12 21 3 12C-3 4 6 0 12 7 18 0 27 4 21 12Z'],
 dice:['m12 2 10 6v9l-10 5L2 17V8Z','m2 8 10 5 10-5','M12 13v9','M7 10v1','M17 10v1','M7 15v1','M17 15v1'],
 sun:['M12 2v3','M12 19v3','M2 12h3','M19 12h3','m5 5 2 2','m17 17 2 2','m5 19 2-2','m17 7 2-2'],
 target:['M12 2v5','M12 17v5','M2 12h5','M17 12h5'],
 book:['M12 6C8 3 4 3 2 4v15c4-1 7 0 10 2 3-2 6-3 10-2V4c-2-1-6-1-10 2Zm0 0v15'],
 pencil:['m4 16 12-12 4 4L8 20l-6 2Z','m13 7 4 4'],
 settings:['m9 3 1-2h4l1 2 3 2 2 1v4l-2 1-1 3 1 2-3 3-2-1-3 1-1 2H6l-1-2-3-2-1-2 2-2 1-3-1-2 3-3 2 1Z'],
 token:['M4 22c0-5 3-7 8-7s8 2 8 7'],
 trash:['M4 6h16','M9 6V3h6v3','m6 6 1 15h10l1-15','M10 10v7','M14 10v7'],
 plus:['M12 4v16','M4 12h16'],
 backpack:['M7 6V4a5 5 0 0 1 10 0v2','M5 6h14l2 5v10H3V11Z','M7 14h10v7','M8 9h8'],
 flask:['M9 2h6','M10 2v7L4 19a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3L14 9V2','M7 15h10'],
 scroll:['M7 3h12a3 3 0 0 1 0 6h-2','M7 3a3 3 0 0 0-3 3v13a3 3 0 0 0 3 3h11V6','M7 22a3 3 0 0 0 0-6H4','M8 8h6','M8 12h6'],
 moon:['M19 16A9 9 0 0 1 8 3a9 9 0 1 0 11 13Z'],
 leaf:['M20 3C5 1 1 10 6 16s15 1 14-13Z','M3 21 16 8','m8 16 0-5 5 1']
};
export function icon(doc,name){
 const ns='http://www.w3.org/2000/svg',svg=doc.createElementNS(ns,'svg');
 svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('class','gw5-icon');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.35');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');
 for(const d of paths[name]||paths.star){const p=doc.createElementNS(ns,'path');p.setAttribute('d',d);svg.append(p);}
 if(['sun','target','settings'].includes(name)){const c=doc.createElementNS(ns,'circle');c.setAttribute('cx','12');c.setAttribute('cy','12');c.setAttribute('r',name==='target'?'7':name==='sun'?'4':'3');svg.append(c);}
 if(name==='token'){const c=doc.createElementNS(ns,'circle');c.setAttribute('cx','12');c.setAttribute('cy','7');c.setAttribute('r','5');svg.append(c);}
 return svg;
}
