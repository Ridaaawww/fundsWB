"""The shape of one program in the repository. Claude fills this in via structured outputs."""

from typing import Literal, Optional

from pydantic import BaseModel, Field


class Program(BaseModel):
    name: str = Field(description="Program name, e.g. 'YC Winter batch' or 'Thiel Fellowship'")
    organization: str = Field(description="Who runs it, e.g. 'Y Combinator'")
    type: Literal["accelerator", "incubator", "fellowship", "grant", "credits", "other"]
    funding_summary: str = Field(
        description="One line on the money: amount, instrument and terms. 'None' if no cash is given."
    )
    max_funding_usd: Optional[int] = Field(
        description="Largest cash amount a founder/startup can get, converted to USD. Null if no cash or not stated."
    )
    equity_taken: str = Field(description="Equity taken, e.g. '7%', 'none', 'via SAFE', or 'not stated'")
    benefits: list[str] = Field(
        description="Non-cash benefits: credits (with $ value), mentorship, office space, demo day, network, visas..."
    )
    eligibility: str = Field(description="Who can apply: stage, age, sector, geography")
    location: str = Field(description="Where it runs: city/country, or 'Remote'")
    application_status: Literal["open", "rolling", "closed", "unknown"]
    deadline: Optional[str] = Field(description="Next application deadline as YYYY-MM-DD, null if none stated")
    apply_url: Optional[str] = Field(description="Direct application link if shown")


class Candidate(BaseModel):
    name: str
    url: str = Field(description="Official page describing the program's funding and benefits")


class Discovery(BaseModel):
    programs: list[Candidate]
