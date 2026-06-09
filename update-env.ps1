$envPath = "c:\Users\IT_STORE\Desktop\Ecommerce\Nova-Ecommerce-project-Backend\.env"
$content = Get-Content $envPath -Raw
$oldUri = "mongodb+srv://sunnypirkash_db_user:2YTA2tt9JZazQdnU@cluster0.gsuwyqf.mongodb.net"
# $newUri = "mongodb+srv://laraibzahra988_db_user:5YPpBSIuf5p7bQQv@cluster0.fryrvvc.mongodb.net"
$content = $content -replace [regex]::Escape($oldUri), $newUri
Set-Content -Path $envPath -Value $content -NoNewline
Write-Host "Updated MONGODB_URI in .env file"
Get-Content $envPath | Select-String "MONGODB_URI"
