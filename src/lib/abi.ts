export const ERC20 = [
  { name:'balanceOf', inputs:[{name:'owner',type:'address'}], outputs:[{type:'uint256'}], stateMutability:'view', type:'function' },
  { name:'allowance', inputs:[{name:'owner',type:'address'},{name:'spender',type:'address'}], outputs:[{type:'uint256'}], stateMutability:'view', type:'function' },
  { name:'approve',   inputs:[{name:'spender',type:'address'},{name:'value',type:'uint256'}], outputs:[{type:'bool'}], stateMutability:'nonpayable', type:'function' },
  { name:'transfer',  inputs:[{name:'to',type:'address'},{name:'value',type:'uint256'}], outputs:[{type:'bool'}], stateMutability:'nonpayable', type:'function' },
  { name:'transferFrom', inputs:[{name:'from',type:'address'},{name:'to',type:'address'},{name:'value',type:'uint256'}], outputs:[{type:'bool'}], stateMutability:'nonpayable', type:'function' },
  { name:'decimals',  inputs:[], outputs:[{type:'uint8'}], stateMutability:'view', type:'function' },
  { name:'name',      inputs:[], outputs:[{type:'string'}], stateMutability:'view', type:'function' },
  { name:'nonces',    inputs:[{name:'owner',type:'address'}], outputs:[{type:'uint256'}], stateMutability:'view', type:'function' },
  { name:'DOMAIN_SEPARATOR', inputs:[], outputs:[{type:'bytes32'}], stateMutability:'view', type:'function' },
] as const;

export const ADMIN_ROUTER_ABI = [
  {
    name: 'pullApproved',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'user', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'usePermit2612',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'owner', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    name: 'setTreasury',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'treasury', type: 'address' }],
    outputs: [],
  },
  {
    name: 'sweepDust',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [],
  },
] as const;
