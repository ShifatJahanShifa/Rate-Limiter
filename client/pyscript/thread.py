import threading
import requests
import time

# API endpoint
url = "http://localhost:4000/tokenbucket"

# Number of threads (simulating concurrent requests)
num_threads = 30

# Function to make a request and print the response
def make_request():
    try:
        response = requests.get(url)
        headers = response.headers

        # Retrieve the specific headers for rate limiting
        rate_limit = headers.get('X-RateLimit-Limit')
        remaining = headers.get('X-RateLimit-Remaining')
        retry_after = headers.get('X-RateLimit-Retry-After')

        # Print the headers and response
        print(f"Response: {response.status_code},   {response.json()}, "
              f"Rate Limit: {rate_limit},  Remaining: {remaining},  Retry-After: {retry_after}")
        # print(f"Response: {response.status_code}, {response.json()}")
    except requests.exceptions.RequestException as e:
        print(f"Error: {e}")

# Function to start threads
def start_threads():
    threads = []
    for _ in range(num_threads):
        thread = threading.Thread(target=make_request)
        thread.start()
        threads.append(thread)
        # Optional: Small delay between threads for more staggered requests
        time.sleep(0)

    # Wait for all threads to complete
    for thread in threads:
        thread.join()

if __name__ == "__main__":
    start_threads()
