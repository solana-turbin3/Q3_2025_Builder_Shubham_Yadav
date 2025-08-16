#!/bin/bash

# Add escrow account to claim operations
sed -i '' '/\.claim()/{
    N;
    s/\.claim()\n        \.accounts({$/\.claim()\n        \.accounts({\n          escrow: escrowPda,/
}' tests/bounty-split.ts

# Add escrow account to fundEscrow operations that don't have it
sed -i '' '/\.fundEscrow.*/{
    N;
    s/\.fundEscrow([^)]*)\n        \.accounts({\n\n          payer:/\.fundEscrow(\1)\n        \.accounts({\n          escrow: escrowPda,\n          payer:/
}' tests/bounty-split.ts

# Same for comprehensive test file
sed -i '' '/\.claim()/{
    N;
    s/\.claim()\n        \.accounts({$/\.claim()\n        \.accounts({\n          escrow: escrowPda,/
}' tests/comprehensive-bounty-split.ts

sed -i '' '/\.fundEscrow.*/{
    N;
    s/\.fundEscrow([^)]*)\n        \.accounts({\n\n          payer:/\.fundEscrow(\1)\n        \.accounts({\n          escrow: escrowPda,\n          payer:/
}' tests/comprehensive-bounty-split.ts

echo "Fixed escrow account references"
