$envPath = "c:\Users\IT_STORE\Desktop\Ecommerce\Nova-Ecommerce-project-Backend\.env"
$newUri = "MONGODB_URI=mongodb+srv://laraibzahra988_db_user:5YPpBSIuf5p7bQQv@cluster0.fryrvvc.mongodb.net"

# Read existing content, remove old MONGODB_URI line, add new one
$content = Get-Content $envPath -Raw
$lines = $content -split "`n" | Where-Object { $_ -notmatch "^MONGODB_URI=" }
$newContent = ($lines + $newUri) -join "`n"
Set-Content -Path $envPath -Value $newContent -NoNewline
Write-Host "Updated MONGODB_URI in .env file to cluster0.fryrvvc.mongodb.net"
