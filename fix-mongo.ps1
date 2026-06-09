$envPath = "c:\Users\IT_STORE\Desktop\Ecommerce\Nova-Ecommerce-project-Backend\.env"
$oldUri = "mongodb+srv://sunnypirkash_db_user:2YTA2tt9JZazQdnU@cluster0.gsuwyqf.mongodb.net"

# Read existing content, remove old MONGODB_URI line, add new one
$content = Get-Content $envPath -Raw
$lines = $content -split "`n" | Where-Object { $_ -notmatch "^MONGODB_URI=" }
$newContent = ($lines + $newUri) -join "`n"
Set-Content -Path $envPath -Value $newContent -NoNewline
Write-Host "Updated MONGODB_URI in .env file to cluster0.fryrvvc.mongodb.net"
