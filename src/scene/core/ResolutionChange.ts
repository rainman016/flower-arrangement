import {createContext} from 'react'
/** Keep Canvas's declarative DPR in sync with measured runtime adjustments. */
export const ResolutionChange=createContext<(ratio:number)=>void>(()=>{})
