const fs = require('fs');
const input = fs.readFileSync('solution.txt', 'utf8');


let grille = input.split("\n").map(ligne => ligne.split(''));

// mtn 2eme etape trouver la pos, L pour ligne etc...
let posL = 0;
let posC = 0;

for(let l = 0; l < grille.length; l++)
    {
        for(let c = 0; c < grille[l].length; c++)
            {
                if(grille[l][c] === '^'){
                posL = l;
                posC = c;
                }
            }
    }
let originPosL = posL;
let originPosC = posC;

let directions = [

    {x : -1, y:0},
    {x : 0, y:1},
    {x : 1, y:0},
    {x : 0, y:-1}
    
];



let curDirection = 0;
let pastCases = new Set();


while(posL >= 0 && posL < grille.length && posC >=0 && posC < grille[0].length)
    {
        let nextL = posL + directions[curDirection].x;
        let nextC = posC + directions[curDirection].y;

        let obstructed = false;
        if(grille[nextL] && grille[nextL][nextC] === '#')
            {
                obstructed = true;
            }
        if(obstructed)
            {
                curDirection = (curDirection + 1) % 4;
            }
        else
            {
                posL = nextL;
                posC = nextC;
            if(posL >= 0 && posL < grille.length && posC >=0 && posC < grille[0].length){
                pastCases.add(`${posL}, ${posC}`);    
            }
            
            }
    }

    console.log(pastCases.size);

////////////////////////partie 2

function simulation(newGrille, startL, startC)
{
    let pl = startL;
    let pc = startC;
    let curDirection = 0;
    let pastCases = new Set();


while(pl >= 0 && pl < newGrille.length && pc >=0 && pc < newGrille[0].length)
    {

        let cle = `${pl},${pc}, ${curDirection}`
        if(pastCases.has(cle))
            {
                return true;
            }
        pastCases.add(cle);


        let nextL = pl + directions[curDirection].x;
        let nextC = pc + directions[curDirection].y;

        let obstructed = false;
        if(newGrille[nextL] && newGrille[nextL][nextC] === '#')
            {
                obstructed = true;
            }
        if(obstructed)
            {
                curDirection = (curDirection + 1) % 4;
            }
        else
            {
                pl = nextL;
                pc = nextC;
            
            }
    }
    return false;
}


let sumLoops = 0;
for(let  l = 0 ; l < grille.length; l++)
    {
        for(let c = 0; c < grille[l].length; c++)
            {
                if(grille[l][c] === '.')
                    {
                        if(!(l === originPosL && c === originPosC))
                            {
                                let grilleSimu = grille.map(ligne => [...ligne]);
                                grilleSimu[l][c] = '#';

                                if(simulation(grilleSimu, originPosL, originPosC))
                                    {
                                        sumLoops++;
                                    }
                            }
                    }  

            }
    }

console.log(sumLoops);