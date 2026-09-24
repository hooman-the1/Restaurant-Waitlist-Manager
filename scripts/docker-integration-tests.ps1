$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $repositoryRoot 'docker-compose.yaml'
$projectName = "restaurant-waitlist-it-$PID"
$baseUrl = 'http://127.0.0.1:8000'

function Invoke-Compose {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

  & docker compose -p $projectName -f $composeFile @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "docker compose failed with exit code $LASTEXITCODE."
  }
}

function Invoke-Api {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [ValidateSet('Get', 'Post')][string]$Method = 'Get',
    [object]$Body,
    [int]$ExpectedStatus = 200
  )

  $request = @{
    Uri         = "$baseUrl$Path"
    Method      = $Method
    ErrorAction = 'Stop'
  }
  if ($null -ne $Body) {
    $request.ContentType = 'application/json'
    $request.Body = $Body | ConvertTo-Json -Compress
  }

  try {
    $response = Invoke-WebRequest @request
    $status = [int]$response.StatusCode
    $json = if ($response.Content) { $response.Content | ConvertFrom-Json } else { $null }
  } catch {
    $webResponse = $_.Exception.Response
    if ($null -eq $webResponse) {
      throw
    }
    $status = [int]$webResponse.StatusCode
    $reader = [System.IO.StreamReader]::new($webResponse.GetResponseStream())
    try {
      $content = $reader.ReadToEnd()
    } finally {
      $reader.Dispose()
    }
    $json = if ($content) { $content | ConvertFrom-Json } else { $null }
  }

  if ($status -ne $ExpectedStatus) {
    throw "Expected HTTP $ExpectedStatus from $Method $Path, received $status."
  }
  return $json
}

function Assert-Equal {
  param($Actual, $Expected, [string]$Message)

  if ($Actual -ne $Expected) {
    throw "$Message Expected '$Expected', received '$Actual'."
  }
}

try {
  Write-Host "Starting isolated Compose project $projectName..."
  Invoke-Compose -Arguments @('up', '-d', '--build')

  $ready = $false
  for ($attempt = 1; $attempt -le 30; $attempt++) {
    try {
      $null = Invoke-Api -Path '/api/restaurants/demo-restaurant'
      $ready = $true
      break
    } catch {
      Start-Sleep -Seconds 2
    }
  }
  if (-not $ready) {
    Invoke-Compose -Arguments @('logs', 'app')
    throw 'The app did not become ready within 60 seconds.'
  }

  $docs = Invoke-WebRequest -Uri "$baseUrl/docs" -UseBasicParsing
  Assert-Equal $docs.StatusCode 200 'Swagger UI should be reachable.'

  $originRequest = Invoke-WebRequest -Uri "$baseUrl/api/restaurants/demo-restaurant" `
    -Headers @{ Origin = 'http://localhost:4200' } -UseBasicParsing
  Assert-Equal $originRequest.Headers['Access-Control-Allow-Origin'] 'http://localhost:4200' `
    'Configured frontend origin should be allowed.'

  $suffix = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $phone = "555-01-$($suffix.ToString().Substring($suffix.ToString().Length - 4))"
  $joinBody = @{
    customerName = 'Docker Integration Guest'
    phone        = $phone
    partySize    = 2
  }
  $join = Invoke-Api -Path '/api/restaurants/demo-restaurant/waitlist-entries' `
    -Method Post -Body $joinBody -ExpectedStatus 201
  if ([string]::IsNullOrWhiteSpace($join.privateStatusToken)) {
    throw 'Join response did not contain a private status token.'
  }
  $token = $join.privateStatusToken

  $duplicate = Invoke-Api -Path '/api/restaurants/demo-restaurant/waitlist-entries' `
    -Method Post -Body $joinBody -ExpectedStatus 409
  Assert-Equal $duplicate.kind 'duplicate-phone' 'Duplicate phone should be rejected.'

  $status = Invoke-Api -Path "/api/waitlist-entries/$token"
  Assert-Equal $status.kind 'active' 'Newly joined guest should be active.'

  $cancel = Invoke-Api -Path "/api/waitlist-entries/$token/cancellations" `
    -Method Post
  Assert-Equal $cancel.kind 'cancelled' 'Cancellation should succeed.'

  $resolved = Invoke-Api -Path "/api/waitlist-entries/$token"
  Assert-Equal $resolved.kind 'resolved' 'Cancelled guest should be resolved.'
  Assert-Equal $resolved.finalStatus 'cancelled' 'Resolved status should be cancelled.'

  Write-Host 'Restarting app container to verify Postgres-backed persistence...'
  Invoke-Compose -Arguments @('restart', 'app')
  $persisted = Invoke-Api -Path "/api/waitlist-entries/$token"
  Assert-Equal $persisted.finalStatus 'cancelled' 'State should survive app restart.'

  $missing = Invoke-Api -Path '/api/restaurants/does-not-exist' -ExpectedStatus 404
  Assert-Equal $missing.kind 'not-found' 'Unknown restaurant should return not-found.'

  Write-Host 'Docker integration tests passed.'
} finally {
  Write-Host "Removing isolated Compose project $projectName and its test volume..."
  & docker compose -p $projectName -f $composeFile down -v --remove-orphans
}
