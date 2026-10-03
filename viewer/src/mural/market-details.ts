import * as THREE from 'three'

/** Authored market props for legibility; no specific excavated stall is implied. */
export function addMarketDetails(market: THREE.Group) {
  const details = new THREE.Group(); details.name = 'Market display details - illustrative'; market.add(details)
  const clay = new THREE.MeshStandardMaterial({ color: '#a16c4f', roughness: 1 })
  const reed = new THREE.MeshStandardMaterial({ color: '#b7a37c', roughness: 1 })
  const grain = new THREE.MeshStandardMaterial({ color: '#d5bc84', roughness: 1 })
  const thread = new THREE.MeshStandardMaterial({ color: '#d7c6a1', roughness: 1 })
  const colors = ['#748879', '#b68568', '#9ea09a', '#c7b087']
  function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) {
    const object = new THREE.Mesh(geometry, material); object.position.set(x,y,z); object.castShadow=true; object.receiveShadow=true; details.add(object); return object
  }
  // Open baskets have visible rims, woven ribs and a surface of displayed grain.
  for (const [x,z] of [[-5.1,-1.45],[-3.75,-1.45],[3.6,-1.45],[5.35,-1.45]]) {
    const basket=mesh(new THREE.CylinderGeometry(.27,.19,.30,16,1,true),reed,x!,.915,z!)
    basket.name='Woven display basket'
    const rim=mesh(new THREE.TorusGeometry(.27,.018,5,24),reed,x!,1.065,z!);rim.rotation.x=Math.PI/2
    mesh(new THREE.CylinderGeometry(.235,.235,.022,16),grain,x!,1.035,z!)
    for(let row=0;row<4;row++) { const band=mesh(new THREE.TorusGeometry(.205+row*.02,.007,3,20),thread,x!,.790+row*.07,z!);band.rotation.x=Math.PI/2 }
    const kernels=new THREE.InstancedMesh(new THREE.SphereGeometry(.018,5,4),grain,35)
    const transform=new THREE.Object3D()
    for(let i=0;i<35;i++){const angle=i*2.4,r=Math.sqrt((i+.5)/35)*.21;transform.position.set(x!+Math.cos(angle)*r,1.053,z!+Math.sin(angle)*r);transform.scale.set(1,.6,1.6);transform.updateMatrix();kernels.setMatrixAt(i,transform.matrix)}
    kernels.castShadow=true;details.add(kernels)
  }
  // Rolled cloth, restrained seams and ties make both stalls readable in a medium shot.
  for(const [side,x] of [[0,-4.5],[1,4.5]]) {
    for(let i=0;i<4;i++){
      const cloth=new THREE.MeshStandardMaterial({color:colors[(i+side!)%colors.length],roughness:1})
      const roll=mesh(new THREE.CylinderGeometry(.095,.095,.75,16),cloth,x!-.6+i*.39,.83,-1.8);roll.rotation.x=Math.PI/2
      for(const z of [-2.04,-1.56]){const tie=mesh(new THREE.TorusGeometry(.099,.008,4,16),thread,x!-.6+i*.39,.83,z);tie.rotation.x=0}
    }
    for(let i=0;i<3;i++){
      const sack=mesh(new THREE.SphereGeometry(.24,12,10),reed,x!-.55+i*.50,.22,-2.15);sack.scale.set(1,.85,.85)
      mesh(new THREE.CylinderGeometry(.055,.095,.09,8),thread,x!-.55+i*.50,.46,-2.15)
    }
  }
  // Small vessels at the central display complement the existing cloth and bamboo staffs.
  for(const [x,z] of [[-.85,.35],[.85,.35]]){
    mesh(new THREE.SphereGeometry(.14,14,10),clay,x!,.86,z!)
    mesh(new THREE.CylinderGeometry(.07,.09,.10,12,1,true),clay,x!,1.01,z!)
  }
  return details
}
