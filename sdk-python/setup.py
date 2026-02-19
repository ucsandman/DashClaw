from setuptools import setup, find_packages

setup(
    name="dashclaw",
    version="2.0.0",
    description="Python SDK for the DashClaw AI agent decision infrastructure platform",
    long_description=open("README.md").read(),
    long_description_content_type="text/markdown",
    author="Wes Sander",
    url="https://github.com/ucsandman/DashClaw",
    packages=find_packages(),
    classifiers=[
        "Programming Language :: Python :: 3",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
    ],
    python_requires=">=3.7",
    install_requires=[], # Zero dependencies for core
    extras_require={
        "langchain": ["langchain-core>=0.1.0"],
    },
)
