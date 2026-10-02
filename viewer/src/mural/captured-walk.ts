import capture from './captured-walk.json'

export const capturedStride = capture.strideInLegLengths
export const capturedWalkSource = capture.sourceCapture

/** Interpolate the captured CMU walk; no arm channels are adopted. */
export function capturedWalk(distance:number,legLength:number,offset=0){
 const cycle=distance/(legLength*capturedStride)+offset
 const phase=cycle-Math.floor(cycle)
 const index=phase*(capture.samples.length-1),i=Math.floor(index),f=index-i
 const a=capture.samples[i]!,b=capture.samples[i+1]!
 const mix=(x:number,y:number)=>x+(y-x)*f
 // The captured ankle is above ToeBase even during flat support. Subtract
 // each side's measured flat-contact baseline before applying shoe roll.
 const footBaseline={left:-.30432594749136693,right:-.2679374394397242}
 const leg=(side:'left'|'right')=>({down:mix(a.legs[side].down,b.legs[side].down)*legLength,forward:mix(a.legs[side].forward,b.legs[side].forward)*legLength,footPitch:mix(a.legs[side].footPitch,b.legs[side].footPitch)-footBaseline[side],lift:mix(a.legs[side].ankleLift,b.legs[side].ankleLift)*legLength})
 return{phase,pelvis:mix(a.pelvis,b.pelvis)*legLength,legs:[leg('left'),leg('right')]}
}
