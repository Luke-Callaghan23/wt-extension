let color;
color = `/* \n\nChange the color here, then CLOSE THE DOCUMENT when you are finished.\n\nNOTE: whenever this document is closed, the color here will be the selected color, but you will have the opportunity to cancel if you're not satisfied\n\nNOTE: please don't edit anything in this document besides the color.  You'll probably break something.\n\n*/\n\n\n\n\n\n\n\n\n\n.word {\n    color: #721a1a;\n}`;
color = `/* \n\nChange the color here, then CLOSE THE DOCUMENT when you are finished.\n\nNOTE: whenever this document is closed, the color here will be the selected color, but you will have the opportunity to cancel if you're not satisfied\n\nNOTE: please don't edit anything in this document besides the color.  You'll probably break something.\n\n*/`;
color = `/*                       




*/









.word                  {
    color     :     #ffff0fff
                                                          }



`;

let colorReg;
colorReg  = /\/\*\s*\*\/\s*.word {\s*color: (?<color>[^;\n]+);?\s*}\s*/

// vv fuck this vv
colorReg  = /\/\*(.|\n)*\*\/\s*.word\s*{\s*color\s*:\s*((?<hex>#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]([0-9a-fA-F][0-9a-fA-F])?)|(?<rgba>rgba\s*\(\s*(?<rgba_r>\d{1-3})\s*,\s*(?<rgba_g>\d{1-3})\s*,\s*(?<rgba_b>\d{1-3})\s*,\s*(?<rgba_a>\d{1-3})\s*\))|(?<rgb>rgb\s*\(\s*(?<rgb_r>\d{1-3})\s*,\s*(?<rgb_g>\d{1-3})\s*,\s*(?<rgb_b>\d{1-3})\s*\)))\s*(;?|\n)\s*}\s*/;
const a = colorReg.exec(color);
console.log(a)