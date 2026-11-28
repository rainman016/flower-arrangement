// Optional explicit adapter for comparable hardware measurements. Never spoofs IDs.
export const gpuArguments=()=>process.env.FLOWER_GPU_LUID?['--use-adapter-luid='+process.env.FLOWER_GPU_LUID]:[]
export function verifyGpu(name){
 const expected=process.env.FLOWER_EXPECT_GPU
 if(expected&&!name.toLowerCase().includes(expected.toLowerCase()))throw Error('Expected GPU '+expected+', received '+name)
 return name
}
