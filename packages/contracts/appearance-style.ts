import type { Appearance } from './stage3.ts';
const accents=['#197062','#315daa','#7350a2','#a34e6d','#a26a27','#39737c','#625a49','#476c3c','#716293','#414c61'];
const backgrounds=['#f1f7f4','#f1f5fb','#f5f2fa','#faf2f5','#faf6ee','#eff7f8','#f7f5f0','#f1f7ee','#f5f3f9','#f2f4f8'];
const fonts={
  system:'"Segoe UI","Microsoft YaHei",sans-serif',
  sans:'Arial,"Microsoft YaHei",sans-serif',
  serif:'Georgia,"Noto Serif SC",serif',
  mono:'Consolas,"Microsoft YaHei",monospace',
};
export function appearanceStyle(value:Appearance){
  const index=Number(value.theme.split('-')[1])-1;
  const background=value.theme.startsWith('gradient-')?`linear-gradient(135deg, ${backgrounds[index]}, ${backgrounds[(index+3)%10]})`:backgrounds[index]!;
  return {
    '--dog-accent':accents[index]!,'--dog-background':background,'--dog-font':fonts[value.font],
    '--dog-title':value.titleSize+'px','--dog-section':value.sectionSize+'px','--dog-body':value.bodySize+'px',
    '--dog-caption':value.captionSize+'px','--dog-nav':value.navSize+'px','--dog-line':String(value.lineHeight),
    '--dog-padding':value.density==='compact'?'16px':'24px',
    '--dog-text':value.contrast==='high'?'#10251c':'#23332f',
    '--dog-muted':value.contrast==='high'?'#465d50':'#819089',
    '--dog-border':value.contrast==='high'?'#8ea596':'#e2e8e4',
  };
}
